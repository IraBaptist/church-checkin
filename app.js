const CONFIG={
  startDate:"2026-08-19",
  googleAppsScriptUrl:"https://script.google.com/macros/s/AKfycbx-vPDWdmq7hlhhG7UCZ0yFPdHLT1MVeh8n-v8cIcazC6Rr47Zj0hqxcPPz41vEInIY/exec"
};

const SESSION_KEYS={teacher:"iraBaptistTeacherSession",admin:"iraBaptistAdminSession"};
const ADMIN_ACTIONS=new Set(["addVolunteer","updateVolunteer","removeVolunteer","mergeVolunteer","mergeTeacher","removeRosterStudent","adminUndoParentCheckin","saveVolunteerSchedule","saveVolunteerScheduleBatch","volunteerAttendance","saveNotes","addWeek","deleteWeek","editWeek","updateStudent","deleteStudent","mergeStudent","saveTeacherAttendanceBatch"]);
const TEACHER_ACTIONS=new Set(["markPresent","unmarkPresent","setStudentAttendance","saveStudentAttendanceBatch","saveAttendanceChangesBatch","addTeacher","saveTeacherAttendance","setTeacherAttendance","addRosterStudent","updateTeacher","removeTeacher","updateRosterProfile"]);
let returningLookup=new Map();

const KEY="iraBaptistCheckinV13";
let state=load(),activeGroup="PreK-K",attendanceChart=null;
let sharedLoadedAt=0;
const SHARED_REFRESH_MS=30000;
const $=id=>document.getElementById(id);

function ensureLoadingUi(){
  if(document.getElementById("v14LoadingOverlay"))return;
  const style=document.createElement("style");
  style.textContent=`
    #v14LoadingOverlay{position:fixed;inset:0;z-index:9999;background:rgba(244,246,248,.92);display:none;align-items:center;justify-content:center;padding:24px}
    #v14LoadingOverlay.show{display:flex}
    #v14LoadingCard{background:#fff;border:1px solid #dfe3e8;border-radius:16px;padding:24px 30px;box-shadow:0 8px 30px #0002;text-align:center;min-width:240px;max-width:90vw}
    #v14LoadingLogo{width:72px;height:72px;object-fit:contain;margin:0 auto 12px;animation:v14Spin 1.35s linear infinite}
    #v14LoadingText{font-weight:700;font-size:17px;color:#1f2937}
    #v14LoadingSub{margin-top:6px;color:#667085;font-size:14px}
    @keyframes v14Spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){#v14LoadingLogo{animation:v14Pulse 1s ease-in-out infinite alternate}@keyframes v14Pulse{from{opacity:.55}to{opacity:1}}}
  `;
  document.head.appendChild(style);
  const overlay=document.createElement("div");
  overlay.id="v14LoadingOverlay";
  overlay.setAttribute("role","status");
  overlay.setAttribute("aria-live","polite");
  overlay.innerHTML=`<div id="v14LoadingCard"><img id="v14LoadingLogo" src="logo.png" alt=""><div id="v14LoadingText">Loading…</div><div id="v14LoadingSub">Connecting to Ira Baptist check-in</div></div>`;
  document.body.appendChild(overlay);
}
function showLoading(message="Loading…",sub="Connecting to Ira Baptist check-in"){
  ensureLoadingUi();
  const overlay=document.getElementById("v14LoadingOverlay");
  const text=document.getElementById("v14LoadingText");
  const subEl=document.getElementById("v14LoadingSub");
  if(text)text.textContent=message;
  if(subEl)subEl.textContent=sub;
  if(overlay)overlay.classList.add("show");
}
function hideLoading(){
  document.getElementById("v14LoadingOverlay")?.classList.remove("show");
}

function defaults(){
  return {
    records:[],students:[],teachers:{},roster:[],notes:{},
    volunteers:[],volunteerSchedule:{},studentAttendance:{},teacherAttendance:{},staffAttendance:{},deletedWeeks:[],customWeeks:[],weeklyStudentAttendance:{},weeklyTeacherAttendance:{}
  };
}
function load(){
  try{return Object.assign(defaults(),JSON.parse(localStorage.getItem(KEY)||"{}"))}
  catch(e){return defaults()}
}
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function esc(x){return String(x??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function id(){return crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random())}

function dates(){
  const out=[];
  let d=new Date(CONFIG.startDate+"T00:00:00");
  for(let i=0;i<53;i++){
    const s=d.toISOString().slice(0,10);
    if(!state.deletedWeeks.includes(s))out.push(s);
    d.setDate(d.getDate()+7);
  }
  (state.customWeeks||[]).forEach(s=>{if(s&&!state.deletedWeeks.includes(s)&&!out.includes(s))out.push(s)});
  return out.sort();
}
function fmt(d){
  return new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"});
}
function currentServiceDate(){
  const ds=dates();
  if(!ds.length)return "";
  const today=new Date();
  today.setHours(0,0,0,0);
  // Default every page to the current/upcoming service Wednesday.
  // On Wednesday, use today. Thursday-Tuesday, use the next Wednesday.
  const upcoming=ds.find(d=>new Date(d+"T00:00:00")>=today);
  return upcoming||ds[ds.length-1];
}
function selectedDate(){return $("adminDate")?.value||currentServiceDate()||dates()[0]}

function serviceDate(){
  return $("parentDate")?.value||$("teacherDate")?.value||$("adminDate")?.value||currentServiceDate()||dates()[0];
}
function setServiceWeek(d,sourceId=""){
  if(!d)return;
  ["parentDate","teacherDate","adminDate"].forEach(idn=>{
    const el=$(idn);
    if(el&&el.value!==d)el.value=d;
  });
  ensureWeek(d);
}
function ensureWeek(d){
  if(!d)return;
  state.weeklyStudentAttendance??={};
  state.weeklyTeacherAttendance??={};
  state.weeklyStudentAttendance[d]??={};
  state.weeklyTeacherAttendance[d]??={};
}
function studentAttendance(studentId,d){
  ensureWeek(d);
  return state.weeklyStudentAttendance[d][studentId]||"absent";
}
function teacherAttendance(teacherId,d){
  ensureWeek(d);
  return state.weeklyTeacherAttendance[d][teacherId]||"absent";
}


function teacherGroup(g){
  if(g==="PreK"||g==="Kindergarten")return"PreK-K";
  if(g==="1st grade"||g==="2nd grade")return"1st-2nd";
  if(g==="3rd grade")return"3rd";
  if(g==="4th grade")return"4th";
  if(g==="5th grade")return"5th";
  if(g==="Adult")return"Adults";
  return ["6th grade","7th grade","8th grade","9th grade","10th grade","11th grade","12th grade"].includes(g)?"Youth":"";
}

function phoneDigits(value){return String(value||"").replace(/\D/g,"").slice(0,10)}
function formatPhone(input){
  if(!input)return;
  const d=phoneDigits(input.value);
  if(d.length<=3) input.value=d.length?`(${d}`:"";
  else if(d.length<=6) input.value=`(${d.slice(0,3)}) ${d.slice(3)}`;
  else input.value=`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
}
const phoneInput=$("phone");
phoneInput?.addEventListener("input",()=>{formatPhone(phoneInput);phoneInput.setCustomValidity(phoneDigits(phoneInput.value).length===10?"":"Please enter a complete 10-digit phone number.")});
phoneInput?.addEventListener("blur",()=>{formatPhone(phoneInput);phoneInput.setCustomValidity(phoneDigits(phoneInput.value).length===10?"":"Please enter a complete 10-digit phone number.")});

async function apiPost(payload){
  const response=await fetch(CONFIG.googleAppsScriptUrl,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify(payload)
  });
  const data=await response.json();
  return data;
}
function tokenForAction(action){
  if(ADMIN_ACTIONS.has(action))return sessionStorage.getItem(SESSION_KEYS.admin)||"";
  if(TEACHER_ACTIONS.has(action))return sessionStorage.getItem(SESSION_KEYS.teacher)||sessionStorage.getItem(SESSION_KEYS.admin)||"";
  return "";
}
function saveLoadingMessage(action){
  const messages={
    checkin:["Submitting registration…","Saving to Ira Baptist check-in"],
    returnCheckin:["Checking in student…","Saving to Ira Baptist check-in"],
    addRosterStudent:["Adding student…","Saving the classroom roster"],
    updateStudent:["Saving student…","Updating the student record"],
    deleteStudent:["Removing student…","Preserving attendance history"],
    mergeStudent:["Merging student records…","Preserving roster and attendance history"],
    setStudentAttendance:["Saving attendance…","Updating the student for this week"],
    saveStudentAttendanceBatch:["Saving attendance…","Saving all pending student changes"],
    saveTeacherAttendanceBatch:["Saving adult attendance…","Saving all pending teacher changes"],
    saveVolunteerScheduleBatch:["Saving volunteer changes…","Saving all pending serving changes"],
    markPresent:["Saving attendance…","Updating the student for this week"],
    unmarkPresent:["Saving attendance…","Updating the student for this week"],
    addTeacher:["Adding teacher…","Saving the classroom team"],
    setTeacherAttendance:["Saving teacher attendance…","Updating this week's attendance"],
    saveTeacherAttendance:["Saving teacher attendance…","Updating this week's attendance"],
    addVolunteer:["Adding volunteer…","Saving the volunteer list"],
    volunteerAttendance:["Saving volunteer attendance…","Updating this week's attendance"],
    saveVolunteerSchedule:["Saving volunteer assignment…","Updating this week's serving schedule"],
    saveNotes:["Saving notes…","Updating this week's notes"],
    addWeek:["Adding week…","Updating the service calendar"],
    editWeek:["Saving week…","Updating the service calendar"],
    deleteWeek:["Removing week…","Preserving historical attendance"]
  };
  return messages[action]||["Saving…","Updating Ira Baptist check-in"];
}
async function sync(payload){
  if(!CONFIG.googleAppsScriptUrl){
    $("connectionStatus").textContent="Local testing mode";
    return {ok:true};
  }
  const overlay=document.getElementById("v14LoadingOverlay");
  const alreadyShowing=!!overlay?.classList.contains("show");
  if(!alreadyShowing){
    const [message,sub]=saveLoadingMessage(payload.action);
    showLoading(message,sub);
  }
  try{
    const token=tokenForAction(payload.action);
    const data=await apiPost(token?{...payload,token}:payload);
    if(!data.ok)throw new Error(data.error||"Google Sheets request failed.");
    $("connectionStatus").textContent="Google Sheets connected";
    return data;
  }catch(e){
    $("connectionStatus").textContent="Connection error";
    console.error(e);
    throw e;
  }finally{
    if(!alreadyShowing)hideLoading();
  }
}

function textValue(v){
  return v===null||v===undefined ? "" : String(v);
}
function normalizeRemoteStudent(s){
  s=s||{};
  const studentFirst=textValue(s.firstName||s.studentFirstName);
  const studentLast=textValue(s.lastName||s.studentLastName);
  const parentFirst=textValue(s.parentFirst||s.parentFirstName);
  const parentLast=textValue(s.parentLast||s.parentLastName);
  const rawName=textValue(s.studentName).trim();
  const combinedName=`${studentFirst} ${studentLast}`.trim();
  const looksLikeId=rawName && (rawName===textValue(s.studentId) || /^\d+$/.test(rawName) || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(rawName));
  return {
    studentId:textValue(s.studentId),
    studentName:combinedName||(!looksLikeId?rawName:""),
    firstName:studentFirst,
    lastName:studentLast,
    parentName:textValue(s.parentName)||`${parentFirst} ${parentLast}`.trim(),
    parentFirst,
    parentLast,
    email:textValue(s.email),phone:textValue(s.phone),age:textValue(s.age),grade:textValue(s.grade),group:textValue(s.group),
    allergies:textValue(s.allergies??s.foodAllergies),
    photoPermission:s.photoPermission??s.photoConsent??false,
    emergencyPermission:s.emergencyPermission??s.transportConsent??false,
    activeRoster:s.activeRoster!==false
  };
}
function applyBootstrap(remote){
  if(!remote)return;
  state.records=(remote.records||[]).map(r=>({
    ...normalizeRemoteStudent(r),
    id:r.id||id(),studentId:r.studentId,date:r.date||"",checkedInAt:r.checkedInAt||"",
    present:!!r.present,presentAt:r.presentAt||null,checkedInBy:"Parent/Guardian"
  }));
  state.students=(remote.students||[]).map(normalizeRemoteStudent);
  state.roster=(remote.roster||[]).map(normalizeRemoteStudent);
  state.teachers={};
  (remote.teachers||[]).forEach(t=>{
    const group=t.group||"";
    if(!group)return;
    state.teachers[group]??=[];
    state.teachers[group].push({id:t.id||t.teacherId||id(),firstName:t.firstName||"",lastName:t.lastName||"",group,role:t.role||"Main Classroom Teacher",allergies:t.allergies||""});
  });
  if(remote.volunteers)state.volunteers=remote.volunteers.map(v=>({id:v.id||v.volunteerId||id(),firstName:v.firstName||"",lastName:v.lastName||"",name:`${v.firstName||""} ${v.lastName||""}`.trim(),allergies:v.allergies||""}));
  if(remote.volunteerSchedule)state.volunteerSchedule=remote.volunteerSchedule;
  if(remote.notes)state.notes=remote.notes;
  if(remote.deletedWeeks)state.deletedWeeks=remote.deletedWeeks;
  if(remote.customWeeks)state.customWeeks=remote.customWeeks;

  state.studentAttendance={}; state.weeklyStudentAttendance={};
  state.records.forEach(r=>{
    if(!r.date||!r.studentId)return;
    state.studentAttendance[r.date]??={}; state.weeklyStudentAttendance[r.date]??={};
    state.studentAttendance[r.date][r.studentId]=r.present?"Present":"Absent";
    state.weeklyStudentAttendance[r.date][r.studentId]=r.present?"present":"absent";
  });
  state.teacherAttendance={}; state.weeklyTeacherAttendance={}; state.staffAttendance={};
  Object.entries(remote.teacherAttendance||{}).forEach(([date,items])=>{
    state.teacherAttendance[date]={}; state.weeklyTeacherAttendance[date]={}; state.staffAttendance[date]={};
    Object.entries(items||{}).forEach(([tid,present])=>{
      const yes=present===true||String(present).toLowerCase()==="true";
      state.teacherAttendance[date][tid]=yes?"Present":"Absent";
      state.weeklyTeacherAttendance[date][tid]=yes?"present":"absent";
      state.staffAttendance[date][tid]={status:yes?"present":"absent",present:yes};
    });
  });
  save();
  if(typeof v14UpdateFloatingSave==="function")v14UpdateFloatingSave();
}
async function loadSharedState(token){
  const data=await apiPost({action:"bootstrap",token});
  if(!data.ok)throw new Error(data.error||"Unable to load shared data.");
  applyBootstrap(data.state);
  sharedLoadedAt=Date.now();
  populateDates();
  renderTeacher();
  renderAdmin();
  return data;
}

function sharedStateIsFresh(){
  return sharedLoadedAt && (Date.now()-sharedLoadedAt)<SHARED_REFRESH_MS;
}
async function ensureAccess(view){
  if(view!=="teacher"&&view!=="admin")return true;
  const key=SESSION_KEYS[view];
  const label=view==="admin"?"Admin":"Teacher";
  let token=sessionStorage.getItem(key)||"";
  if(view==="teacher"&&!token)token=sessionStorage.getItem(SESSION_KEYS.admin)||"";

  if(token){
    showLoading(`Loading ${label} Page…`,"Checking your session");
    try{
      const check=await apiPost({action:"validateSession",token});
      if(!check.ok)throw new Error(check.error||"Session expired.");

      // Wait for authoritative, date-specific data before displaying attendance.
      // A cached prior week must never masquerade as the new week's attendance.
      showLoading(`Loading ${label} Page…`,"Getting the latest roster and attendance");
      await loadSharedState(token);
      hideLoading();
      return true;
    }catch(e){
      sessionStorage.removeItem(key);
      if(view==="teacher")sessionStorage.removeItem(SESSION_KEYS.teacher);
      hideLoading();
      token="";
    }
  }

  // Ask for the password before doing any spreadsheet work so the prompt
  // appears immediately after the Teacher/Admin tab is clicked.
  const password=prompt(`${label} password:`);
  if(password===null)return false;

  showLoading("Signing in…","Loading the latest roster and attendance");
  try{
    // One request now handles both authentication and initial page data.
    const login=await apiPost({action:"login",password,includeState:true});
    if(!login.ok)throw new Error(login.error||"Incorrect password.");
    if(view==="admin"&&login.role!=="admin")throw new Error("That is not the Admin password.");
    sessionStorage.setItem(SESSION_KEYS[login.role],login.token);
    if(login.state)applyBootstrap(login.state);
    sharedLoadedAt=Date.now();
    populateDates();
    renderTeacher();
    renderAdmin();
    hideLoading();
    return true;
  }catch(e){
    hideLoading();
    alert(e.message||"Login failed.");
    return false;
  }
}
async function loadPublicCalendar(){
  if(!CONFIG.googleAppsScriptUrl)return;
  try{
    const data=await apiPost({action:"publicCalendar"});
    if(data.ok){state.deletedWeeks=data.deletedWeeks||[];state.customWeeks=data.customWeeks||[];save()}
  }catch(e){console.warn("Could not load service calendar",e)}
}

function populateDates(){
  const ds=dates();
  const fallback=currentServiceDate()||ds[0]||"";
  ["parentDate","teacherDate","adminDate"].forEach(idn=>{
    const el=$(idn);
    if(!el)return;
    const old=el.value;
    el.innerHTML=ds.map(d=>`<option value="${d}">${fmt(d)}</option>`).join("");
    el.value=ds.includes(old)?old:fallback;
  });
  const preserved=ds.includes($("adminDate")?.value)?$("adminDate").value:(ds.includes(v14PageState?.week)?v14PageState.week:fallback);
  setServiceWeek(preserved);
}


function normalizeTeacher(t, fallbackGroup=""){
  if(typeof t==="string") {
    const p=t.trim().split(/\s+/);
    return {id:id(),firstName:p.shift()||"",lastName:p.join(" "),group:fallbackGroup};
  }
  if(t && typeof t==="object") {
    return {
      id:t.id||id(),
      firstName:t.firstName||"",
      lastName:t.lastName||"",
      group:t.group||fallbackGroup,role:t.role||"Main Classroom Teacher",allergies:t.allergies||""
    };
  }
  return {id:id(),firstName:"",lastName:"",group:fallbackGroup};
}
function teacherName(t){
  t=normalizeTeacher(t);
  return `${t.firstName} ${t.lastName}`.trim()||"Unnamed teacher";
}
function legacyTeacherAttendance(date, teacherId){
  const day=state.teacherAttendance?.[date]||{};
  return day[teacherId]||"Absent";
}
function studentStatus(date, studentId){return (state.studentAttendance?.[date]||{})[studentId]||"Absent"}
function studentRecord(date, studentId){return state.records.find(r=>r.date===date&&r.studentId===studentId)||null}

// Permanent student information lives independently from weekly check-in/attendance.
// Historical records are used as a fallback so older V13.x data keeps its details.
function studentProfile(studentId){
  const saved=state.students.find(s=>s.studentId===studentId)||{};
  const historical=[...state.records].reverse().find(r=>r.studentId===studentId)||{};
  const roster=state.roster.find(r=>r.studentId===studentId)||{};
  return {
    ...roster,
    ...historical,
    ...saved,
    studentId,
    activeRoster:roster.studentId?(roster.activeRoster!==false):(saved.activeRoster??true),
    studentName:[saved.firstName||historical.firstName||roster.firstName||"",saved.lastName||historical.lastName||roster.lastName||""].filter(Boolean).join(" ")||saved.studentName||historical.studentName||roster.studentName||"",
    firstName:saved.firstName||historical.firstName||roster.firstName||"",
    lastName:saved.lastName||historical.lastName||roster.lastName||"",
    parentName:saved.parentName||historical.parentName||"",
    parentFirst:saved.parentFirst||historical.parentFirst||"",
    parentLast:saved.parentLast||historical.parentLast||"",
    phone:saved.phone||historical.phone||"",
    email:saved.email||historical.email||"",
    age:saved.age||historical.age||"",
    grade:saved.grade||historical.grade||roster.grade||"",
    group:saved.group||historical.group||roster.group||"",
    allergies:(roster.studentId||saved.studentId)
      ?(String(roster.allergies||"").trim()||String(saved.allergies||"").trim())
      :String(historical.allergies||""),
    photoPermission:saved.photoPermission??historical.photoPermission??false,
    emergencyPermission:saved.emergencyPermission??historical.emergencyPermission??false
  };
}
function renderTeacher(){
  const d=$("teacherDate")?.value||dates()[0];
  ensureWeek(d);
  $("teacherGroupTitle").textContent=activeGroup;

  const teacherItems=state.teachers[activeGroup]||[];
  const teacherNames=teacherItems.map(t=>{
    if(typeof t==="string") return t;
    return `${t.firstName||""} ${t.lastName||""}`.trim();
  }).filter(Boolean);
  $("teacherNames").textContent=teacherNames.join(", ")||"No teachers added yet";

  const roster=state.roster.filter(r=>r.group===activeGroup&&r.activeRoster!==false);
  const students=state.students.filter(s=>s.group===activeGroup&&s.activeRoster!==false);
  const checked=state.records.filter(r=>r.date===d&&r.group===activeGroup&&!!r.checkedInAt&&studentProfile(r.studentId).activeRoster!==false);

  const byStudent=new Map();
  [...roster,...students].forEach(s=>{
    if(!s.studentId||byStudent.has(s.studentId))return;
    byStudent.set(s.studentId,{
      studentId:s.studentId,
      studentName:s.studentName,
      grade:s.grade,
      checkedIn:false
    });
  });
  checked.forEach(r=>{
    byStudent.set(r.studentId,{
      studentId:r.studentId,
      studentName:r.studentName,
      grade:r.grade,
      checkedIn:true
    });
  });

  const rows=[...byStudent.values()];
  $("teacherTable").innerHTML=rows.length?`<table><thead><tr>
    <th>Student</th><th>Grade</th><th>Parent Check-In</th><th>Class Attendance</th>
  </tr></thead><tbody>${rows.map(r=>{
    const present=studentAttendance(r.studentId,d)==="present";
    return `<tr>
      <td>${esc(r.studentName)}</td>
      <td>${esc(r.grade)}</td>
      <td>${r.checkedIn?"Checked In":"Not Checked In"}</td>
      <td><button type="button" class="attendance-btn ${present?"attendance-present":"attendance-absent"}" onclick="setStudentAttendance('${r.studentId}','${d}','${present?"absent":"present"}')">${present?"Present":"Absent"}</button></td>
    </tr>`;
  }).join("")}</tbody></table>`:"<p class='muted'>No students in this group yet.</p>";

  $("teacherList").innerHTML=teacherItems.map((t,i)=>{
    let idv,name;
    if(typeof t==="string"){
      idv=t;
      name=t;
    }else{
      idv=t.id||t.teacherId||String(i);
      name=`${t.firstName||""} ${t.lastName||""}`.trim();
    }
    const present=teacherAttendance(idv,d)==="present";
    return `<div class="teacher-attendance-row">
      <strong>${esc(name)}</strong>
      <button type="button" class="attendance-btn ${present?"attendance-present":"attendance-absent"}" onclick="setTeacherAttendance('${esc(idv)}','${d}','${present?"absent":"present"}')">${present?"Present":"Absent"}</button>
    </div>`;
  }).join("")||"<p class='muted'>No teachers added yet.</p>";
}


window.setStudentAttendance=async(studentId,date,status)=>{
  ensureWeek(date);
  const previous=state.weeklyStudentAttendance[date][studentId]||"absent";
  const next=status==="present"?"present":"absent";
  state.weeklyStudentAttendance[date][studentId]=next;
  state.studentAttendance??={};
  state.studentAttendance[date]??={};
  state.studentAttendance[date][studentId]=next==="present"?"Present":"Absent";
  save(); renderTeacher(); renderAdmin();
  try{
    await sync({action:"setStudentAttendance",studentId,date,status:next});
  }catch(e){
    state.weeklyStudentAttendance[date][studentId]=previous;
    state.studentAttendance[date][studentId]=previous==="present"?"Present":"Absent";
    save(); renderTeacher(); renderAdmin();
    alert("Attendance did not save. The previous status has been restored.");
  }
};
window.setTeacherAttendance=async(teacherId,date,status)=>{
  ensureWeek(date);
  const previous=state.weeklyTeacherAttendance[date][teacherId]||"absent";
  const next=status==="present"?"present":"absent";
  state.weeklyTeacherAttendance[date][teacherId]=next;
  state.teacherAttendance??={};
  state.teacherAttendance[date]??={};
  state.teacherAttendance[date][teacherId]=next==="present"?"Present":"Absent";
  state.staffAttendance??={};
  state.staffAttendance[date]??={};
  state.staffAttendance[date][teacherId]={status:next,present:next==="present"};
  save(); renderTeacher(); renderAdmin();
  try{
    await sync({action:"setTeacherAttendance",teacherId,date,status:next});
  }catch(e){
    state.weeklyTeacherAttendance[date][teacherId]=previous;
    state.teacherAttendance[date][teacherId]=previous==="present"?"Present":"Absent";
    state.staffAttendance[date][teacherId]={status:previous,present:previous==="present"};
    save(); renderTeacher(); renderAdmin();
    alert("Teacher attendance did not save. The previous status has been restored.");
  }
};
window.markPresent=async rid=>{
  const r=state.records.find(x=>x.id===rid);
  if(!r)return;
  r.present=!r.present;
  r.presentAt=r.present?new Date().toISOString():null;
  save();
  renderTeacher();
  renderAdmin();
  await sync({action:r.present?"markPresent":"unmarkPresent",id:rid,present:r.present});
};


function v14PersonKey(first,last,id){
  const name=[textValue(first).trim().toLowerCase(),textValue(last).trim().toLowerCase()].filter(Boolean).join("|");
  return name||`id:${textValue(id)}`;
}
function weeklyMetrics(date){
  const d=String(date||"");
  const activeStudentIds=new Set(v14AdminProfiles().map(x=>String(x.studentId)));
  const students=Object.entries((state.studentAttendance||{})[d]||{}).filter(([sid,v])=>activeStudentIds.has(String(sid))&&v==="Present").length;

  const activeTeachers=v14TeacherRows();
  const teacherIds=new Set(activeTeachers.map(t=>String(t.id||t.teacherId)));
  const teacherPresent=new Set();
  Object.entries((state.staffAttendance||{})[d]||{}).forEach(([tid,x])=>{
    if(teacherIds.has(String(tid))&&x?.status==="present")teacherPresent.add(String(tid));
  });

  const activeVolunteers=state.volunteers||[];
  const volunteerIds=new Set(activeVolunteers.map(v=>String(v.id)));
  const volunteerPresent=new Set();
  Object.entries((state.volunteerSchedule||{})[d]||{}).forEach(([vid,x])=>{
    if(volunteerIds.has(String(vid))&&x?.present)volunteerPresent.add(String(vid));
  });

  const adultKeys=new Set();
  activeTeachers.forEach(t=>{const tid=String(t.id||t.teacherId);if(teacherPresent.has(tid))adultKeys.add(v14PersonKey(t.firstName,t.lastName,tid));});
  activeVolunteers.forEach(v=>{const vid=String(v.id);if(volunteerPresent.has(vid))adultKeys.add(v14PersonKey(v.firstName,v.lastName,vid));});

  return {studentTotal:students,teacherTotal:teacherPresent.size,volunteerTotal:volunteerPresent.size,adultTotal:adultKeys.size,total:students+adultKeys.size};
}

function renderChart(){
  const c=$("attendanceChart");
  if(!c||typeof Chart==="undefined")return;
  const labels=[],students=[],adults=[],totals=[],notes=[];
  dates().forEach(d=>{
    const m=weeklyMetrics(d),note=String((state.notes||{})[d]||"").trim();
    labels.push(new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"})+(note?" •":""));
    students.push(m.studentTotal);adults.push(m.adultTotal);totals.push(m.total);notes.push(note);
  });
  if(attendanceChart)attendanceChart.destroy();
  attendanceChart=new Chart(c,{
    type:"line",
    data:{labels,datasets:[
      {label:"Students",data:students,tension:.25},
      {label:"Adults",data:adults,tension:.25},
      {label:"Total",data:totals,tension:.25}
    ]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}},plugins:{tooltip:{callbacks:{afterBody(items){if(!items?.length)return"";const note=notes[items[0].dataIndex];return note?`Note: ${note}`:"";}}}}}
  });
}


function allAdminStudentProfiles(){
  const ids=new Set();
  state.students.forEach(s=>s.studentId&&ids.add(String(s.studentId)));
  state.roster.forEach(r=>r.studentId&&ids.add(String(r.studentId)));
  state.records.forEach(r=>r.studentId&&ids.add(String(r.studentId)));
  return [...ids].map(studentId=>studentProfile(studentId));
}
function isRegisteredStudent(studentId){
  return state.students.some(s=>String(s.studentId)===String(studentId));
}
function profileCompleteness(p){
  return [p.parentName,p.email,p.phone,p.age,p.allergies,p.grade,p.group].filter(Boolean).length + (p.photoPermission?1:0) + (p.emergencyPermission?1:0);
}
function ensureMergeStudentUi(){
  if($("mergeStudentModal"))return;
  const style=document.createElement("style");
  style.textContent=`
    #mergeStudentModal{position:fixed;inset:0;z-index:9998;background:#0007;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto}
    #mergeStudentModal.hidden{display:none}
    #mergeStudentCard{background:#fff;border-radius:16px;max-width:780px;width:min(780px,96vw);padding:22px;box-shadow:0 14px 40px #0004}
    #mergeStudentCard .merge-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    #mergeStudentCard label{display:block;font-weight:700;font-size:13px}
    #mergeStudentCard input,#mergeStudentCard select{width:100%;box-sizing:border-box;margin-top:4px}
    #mergeStudentCard .merge-records{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
    #mergeStudentCard .merge-record{border:1px solid #ddd;border-radius:10px;padding:10px;background:#fafafa}
    #mergeStudentCard .merge-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
    @media(max-width:650px){#mergeStudentCard .merge-grid,#mergeStudentCard .merge-records{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
  const modal=document.createElement("div");
  modal.id="mergeStudentModal";
  modal.className="hidden";
  modal.innerHTML=`<div id="mergeStudentCard">
    <h2 style="margin-top:0">Merge duplicate students</h2>
    <p class="muted">Attendance history from both records will be preserved. Choose the final student information below.</p>
    <input type="hidden" id="mergePrimaryId">
    <label>Duplicate record to merge<select id="mergeOtherId"></select></label>
    <div class="merge-records"><div class="merge-record" id="mergeRecordA"></div><div class="merge-record" id="mergeRecordB"></div></div>
    <label>Keep identity<select id="mergeSurvivorChoice"></select></label>
    <h3>Final student information</h3>
    <div class="merge-grid">
      <label>First name<input id="mergeFirstName"></label>
      <label>Last name<input id="mergeLastName"></label>
      <label>Parent first name<input id="mergeParentFirst"></label>
      <label>Parent last name<input id="mergeParentLast"></label>
      <label>Email<input id="mergeEmail" type="email"></label>
      <label>Phone<input id="mergePhone" type="tel"></label>
      <label>Age<input id="mergeAge"></label>
      <label>Grade<input id="mergeGrade"></label>
      <label style="grid-column:1/-1">Food allergies<input id="mergeAllergies"></label>
      <label><input id="mergePhoto" type="checkbox" style="width:auto"> Photo permission</label>
      <label><input id="mergeEmergency" type="checkbox" style="width:auto"> Emergency transport permission</label>
    </div>
    <div id="mergeStudentMessage" class="muted" style="margin-top:10px"></div>
    <div class="merge-actions"><button type="button" onclick="closeMergeStudent()">Cancel</button><button type="button" id="mergeSubmitBtn" class="primary" onclick="submitMergeStudent()" disabled>Merge Students</button></div>
  </div>`;
  document.body.appendChild(modal);
  $("mergeOtherId").addEventListener("change",refreshMergeStudentUi);
  $("mergeSurvivorChoice").addEventListener("change",refreshMergeFinalFields);
  $("mergePhone").addEventListener("input",()=>formatPhone($("mergePhone")));
}
function shortStudentId(id){
  const v=String(id||"");
  return v?`ID …${v.slice(-5)}`:"";
}
function mergeLabel(p){
  const reg=isRegisteredStudent(p.studentId)?"Parent registered":"Teacher/roster record";
  const detail=[p.grade||p.group||"",reg,p.parentName?`Parent: ${p.parentName}`:"",p.email||"",shortStudentId(p.studentId)].filter(Boolean);
  return `${p.studentName||"Unnamed student"} — ${detail.join(" — ")}`;
}
function mergeSummary(p){
  const reg=isRegisteredStudent(p.studentId)?"Parent registered":"Teacher/roster record";
  return `<strong>${esc(p.studentName||"Unnamed student")}</strong><div class="muted">${esc(p.grade||"")} ${p.group?`· ${esc(p.group)}`:""}</div><div class="muted">${esc(reg)} · ${esc(shortStudentId(p.studentId))}</div><div>${p.parentName?`Parent: ${esc(p.parentName)}`:"Parent: —"}</div><div>${p.email?esc(p.email):"Email: —"}</div>`;
}
function refreshMergeFinalFields(){
  const a=studentProfile($("mergePrimaryId").value);
  const b=studentProfile($("mergeOtherId").value);
  const survivorId=$("mergeSurvivorChoice").value;
  if(!a.studentId||!b.studentId||!survivorId)return;
  const preferred=survivorId===a.studentId?a:b;
  const other=survivorId===a.studentId?b:a;
  const pick=(x,y)=>x||y||"";
  $("mergeFirstName").value=pick(preferred.firstName,other.firstName);
  $("mergeLastName").value=pick(preferred.lastName,other.lastName);
  $("mergeParentFirst").value=pick(preferred.parentFirst,other.parentFirst);
  $("mergeParentLast").value=pick(preferred.parentLast,other.parentLast);
  $("mergeEmail").value=pick(preferred.email,other.email);
  $("mergePhone").value=pick(preferred.phone,other.phone); formatPhone($("mergePhone"));
  $("mergeAge").value=pick(preferred.age,other.age);
  $("mergeGrade").value=pick(preferred.grade,other.grade);
  $("mergeAllergies").value=pick(preferred.allergies,other.allergies);
  $("mergePhoto").checked=!!(preferred.photoPermission||other.photoPermission);
  $("mergeEmergency").checked=!!(preferred.emergencyPermission||other.emergencyPermission);
  $("mergeStudentMessage").textContent="You may edit the final name and other fields before merging.";
}
function refreshMergeStudentUi(){
  const a=studentProfile($("mergePrimaryId").value);
  const otherId=$("mergeOtherId").value;
  const choice=$("mergeSurvivorChoice");
  const submit=$("mergeSubmitBtn");
  if(!otherId){
    $("mergeRecordA").innerHTML=mergeSummary(a);
    $("mergeRecordB").innerHTML='<span class="muted">Select the duplicate record above.</span>';
    choice.innerHTML='<option value="">Select duplicate first</option>';
    choice.disabled=true;
    if(submit)submit.disabled=true;
    $("mergeStudentMessage").textContent="Choose the duplicate student record. No record is selected automatically.";
    return;
  }
  const b=studentProfile(otherId);
  if(!a.studentId||!b.studentId)return;
  $("mergeRecordA").innerHTML=mergeSummary(a);
  $("mergeRecordB").innerHTML=mergeSummary(b);
  choice.disabled=false;
  choice.innerHTML=`<option value="${esc(a.studentId)}">${esc(mergeLabel(a))}</option><option value="${esc(b.studentId)}">${esc(mergeLabel(b))}</option>`;
  const aReg=isRegisteredStudent(a.studentId), bReg=isRegisteredStudent(b.studentId);
  if(bReg&&!aReg)choice.value=b.studentId;
  else if(aReg&&!bReg)choice.value=a.studentId;
  else choice.value=profileCompleteness(b)>profileCompleteness(a)?b.studentId:a.studentId;
  if(submit)submit.disabled=false;
  refreshMergeFinalFields();
}
window.openMergeStudent=studentId=>{
  ensureMergeStudentUi();
  const primary=studentProfile(studentId);
  const norm=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
  const options=allAdminStudentProfiles().filter(p=>String(p.studentId)!==String(studentId));
  if(!options.length){alert("There are no other student records to merge.");return;}
  // Likely duplicates are listed first, but nothing is automatically selected.
  options.sort((a,b)=>{
    const score=p=>{
      let n=0;
      if(norm(p.lastName)&&norm(p.lastName)===norm(primary.lastName))n+=4;
      if(norm(p.firstName)&&norm(p.firstName)===norm(primary.firstName))n+=4;
      if(primary.grade&&p.grade&&norm(p.grade)===norm(primary.grade))n+=2;
      if(primary.group&&p.group&&norm(p.group)===norm(primary.group))n+=1;
      return n;
    };
    return score(b)-score(a)||(a.studentName||"").localeCompare(b.studentName||"");
  });
  $("mergePrimaryId").value=studentId;
  $("mergeOtherId").innerHTML='<option value="">Select duplicate student…</option>'+options.map(p=>`<option value="${esc(p.studentId)}">${esc(mergeLabel(p))}</option>`).join("");
  $("mergeOtherId").value="";
  refreshMergeStudentUi();
  $("mergeStudentModal").classList.remove("hidden");
};
window.closeMergeStudent=()=>$("mergeStudentModal")?.classList.add("hidden");
window.submitMergeStudent=async()=>{
  const a=$("mergePrimaryId").value,b=$("mergeOtherId").value,survivorId=$("mergeSurvivorChoice").value;
  if(!a||!b||!survivorId||a===b){$("mergeStudentMessage").textContent="Select two different student records before merging.";return;}
  const duplicateId=survivorId===a?b:a;
  const firstName=$("mergeFirstName").value.trim(),lastName=$("mergeLastName").value.trim();
  if(!firstName||!lastName){$("mergeStudentMessage").textContent="First and last name are required.";return;}
  const finalStudent={
    firstName,lastName,
    parentFirst:$("mergeParentFirst").value.trim(),parentLast:$("mergeParentLast").value.trim(),
    email:$("mergeEmail").value.trim(),phone:$("mergePhone").value.trim(),age:$("mergeAge").value.trim(),
    grade:$("mergeGrade").value.trim(),group:teacherGroup($("mergeGrade").value.trim())||studentProfile(survivorId).group||studentProfile(duplicateId).group||"",
    allergies:$("mergeAllergies").value.trim(),photoPermission:$("mergePhoto").checked,emergencyPermission:$("mergeEmergency").checked
  };
  if(!confirm(`Merge these two student records into ${firstName} ${lastName}? Attendance history from both IDs will be preserved.`))return;
  showLoading("Merging student records…","Preserving roster and attendance history");
  try{
    await sync({action:"mergeStudent",survivorId,duplicateId,student:finalStudent});
    const token=sessionStorage.getItem(SESSION_KEYS.admin)||"";
    if(token)await loadSharedState(token);
    closeMergeStudent();
    hideLoading();
    alert(`${firstName} ${lastName} is now one student record.`);
  }catch(e){hideLoading();$("mergeStudentMessage").textContent=e.message||"Merge failed.";}
};

function renderAdmin(){
  const d=selectedDate();

  // Build the Admin master list from permanent student profiles, not from one week's record.
  // Weekly records only determine whether that student checked in for the selected week.
  const ids=new Set();
  state.students.forEach(s=>s.studentId&&ids.add(s.studentId));
  state.roster.forEach(r=>r.studentId&&ids.add(r.studentId));
  state.records.forEach(r=>r.studentId&&ids.add(r.studentId));

  const rows=[...ids].map(studentId=>{
    const profile=studentProfile(studentId);
    const weekRecord=studentRecord(d,studentId);
    return {
      ...profile,
      studentId,
      checkedIn:!!weekRecord?.checkedInAt,
      checkedInBy:weekRecord?.checkedInBy||"",
      checkedInAt:weekRecord?.checkedInAt||"",
      present:studentStatus(d,studentId)==="Present"
    };
  });

  const sortMode=$("adminSort")?.value||"class-last";

  const lastNameOf=r=>{
    if(r.lastName)return r.lastName.toLowerCase();
    return (r.studentName||"").trim().split(/\s+/).pop().toLowerCase();
  };
  const classOf=r=>(r.group||"").toLowerCase();

  rows.sort((a,b)=>{
    if(sortMode==="last-class"){
      return lastNameOf(a).localeCompare(lastNameOf(b)) ||
             classOf(a).localeCompare(classOf(b));
    }
    return classOf(a).localeCompare(classOf(b)) ||
           lastNameOf(a).localeCompare(lastNameOf(b));
  });

  $("adminDateTitle").textContent=fmt(d);
  $("checkedInCount").textContent=rows.filter(r=>r.checkedIn).length;
  $("presentCount").textContent=rows.filter(r=>r.present).length;
  $("attendanceRate").textContent=rows.length
    ? Math.round(rows.filter(r=>r.present).length/rows.length*100)+"%"
    : "0%";

  $("adminTable").innerHTML=rows.length?`
    <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>Class</th>
          <th>Last name</th>
          <th>First name</th>
          <th>Parent/guardian</th>
          <th>Phone</th>
          <th>Email</th>
          <th>Age</th>
          <th>Grade</th>
          <th>Allergies</th>
          <th>Photo permission</th>
          <th>Emergency transport</th>
          <th>Parent check-in</th>
          <th>Class status</th>
          <th>Record</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${esc(r.group)}</td>
            <td>${esc(r.lastName||lastNameOf(r))}</td>
            <td>${esc(r.firstName||((r.studentName||"").trim().split(/\s+/)[0]||""))}</td>
            <td>${esc(r.parentName||`${r.parentFirst||""} ${r.parentLast||""}`.trim())}</td>
            <td>${esc(r.phone)}</td>
            <td>${esc(r.email)}</td>
            <td>${esc(r.age)}</td>
            <td>${esc(r.grade)}</td>
            <td>${esc(r.allergies)||"—"}</td>
            <td>${r.photoPermission?"Yes":"No"}</td>
            <td>${r.emergencyPermission?"Yes":"No"}</td>
            <td>${r.checkedIn?"Checked In":"Not Checked In"}</td>
            <td>${r.present?"Present":"Absent"}</td>
            <td><div class="record-actions"><button type="button" class="small" onclick="openEditStudent('${r.studentId}')">Edit</button><button type="button" class="small" onclick="openMergeStudent('${r.studentId}')">Merge</button><button type="button" class="danger small" onclick="deleteStudentRecord('${r.studentId}')">Delete</button></div></td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`
    :"<p class='muted'>No students have been added yet.</p>";

  const wm=weeklyMetrics(d);
  $("weeklyStudentTotal").textContent=wm.studentTotal;
  $("weeklyTeacherTotal").textContent=wm.teacherTotal;
  $("weeklyTotal").textContent=wm.total;
  $("dailyNotes").value=state.notes[d]||"";

  renderVolunteers();
  renderChart();
}

function renderVolunteers(){
  const d=selectedDate(),sch=state.volunteerSchedule[d]||{};
  if(!state.volunteers.length){
    $("volunteerTable").innerHTML="<p class='muted'>No volunteers added yet.</p>";
    return;
  }

  const areas=["Kitchen","PreK-K","1st-2nd","3rd","4th","5th","Youth","Adult Class","Other"];

  $("volunteerTable").innerHTML=`
    <table><thead><tr>
      <th>First name</th><th>Last name</th><th>Present</th><th>Serving</th><th>Where</th><th>Other location</th>
    </tr></thead>
    <tbody>${state.volunteers.map(v=>{
      const x=v14EffectiveVolunteer(v.id,d);
      return `<tr>
        <td>${esc(v.firstName||v.name||"")}</td>
        <td>${esc(v.lastName||"")}</td>
        <td><button type="button" class="${x.present?"primary":""}" onclick="toggleVolunteerPresent('${v.id}')">${x.present?"Present — click to undo":"Not present"}</button></td>
        <td><button type="button" onclick="toggleVolunteer('${v.id}')">${x.serving?"Serving":"Not serving"}</button></td>
        <td><select onchange="setVolunteerArea('${v.id}',this.value)" ${x.serving?"":"disabled"}>
          <option value="">Select</option>${areas.map(a=>`<option ${x.area===a?"selected":""}>${a}</option>`).join("")}
        </select></td>
        <td>${x.area==="Other"?`<input value="${esc(x.other)}" onchange="setVolunteerOther('${v.id}',this.value)" placeholder="Where are they serving?">`:"—"}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

window.toggleVolunteerPresent=async idv=>{
  const d=selectedDate();
  state.volunteerSchedule[d]??={};
  const x=state.volunteerSchedule[d][idv]||{serving:false,area:"",other:"",present:false};
  x.present=!x.present;
  state.volunteerSchedule[d][idv]=x;
  save();
  renderVolunteers();
  renderAdmin();
  await sync({action:"volunteerAttendance",date:d,volunteerId:idv,present:x.present});
};

async function saveVS(idv){
  save();
  await sync({
    action:"saveVolunteerSchedule",
    date:selectedDate(),
    volunteerId:idv,
    schedule:(state.volunteerSchedule[selectedDate()]||{})[idv]||{}
  });
  renderVolunteers();
}

window.toggleVolunteer=async idv=>{
  const d=selectedDate();
  state.volunteerSchedule[d]??={};
  const x=state.volunteerSchedule[d][idv]||{serving:false,area:"",other:"",present:false};
  x.serving=!x.serving;
  if(!x.serving){x.area="";x.other=""}
  state.volunteerSchedule[d][idv]=x;
  await saveVS(idv);
};

window.setVolunteerArea=async(idv,a)=>{
  const d=selectedDate();
  state.volunteerSchedule[d]??={};
  const x=state.volunteerSchedule[d][idv]||{serving:true,area:"",other:"",present:false};
  x.serving=true;x.area=a;
  if(a!=="Other")x.other="";
  state.volunteerSchedule[d][idv]=x;
  await saveVS(idv);
};

window.setVolunteerOther=async(idv,o)=>{
  const d=selectedDate();
  state.volunteerSchedule[d]??={};
  const x=state.volunteerSchedule[d][idv]||{serving:true,area:"Other",other:"",present:false};
  x.serving=true;x.area="Other";x.other=o;
  state.volunteerSchedule[d][idv]=x;
  save();
  await sync({action:"saveVolunteerSchedule",date:d,volunteerId:idv,schedule:x});
  renderVolunteers();
};

$("parentForm").addEventListener("submit",async e=>{
  e.preventDefault();

  const first=$("studentFirstName").value.trim();
  const last=$("studentLastName").value.trim();
  const parentFirst=$("parentFirstName").value.trim();
  const parentLast=$("parentLastName").value.trim();
  const email=$("email").value.trim();
  const phone=$("phone").value.trim();
  const phoneDigits=phone.replace(/\D/g,"");
  $("phone").setCustomValidity(phoneDigits.length===10?"":"Please enter a complete 10-digit phone number.");
  const grade=$("grade").value;
  const age=$("age").value;
  const allergies=$("allergies").value.trim();
  const photoPermission=$("photoPermission").checked;
  const emergencyPermission=$("emergencyPermission").checked;

  if(!first||!last||!parentFirst||!parentLast||!email||phoneDigits.length!==10||!grade||!age){
    $("parentMessage").textContent=phoneDigits.length!==10?"Please enter a complete 10-digit phone number.":!email?"Email is required.":!grade?"Grade is required.":!age?"Age is required.":"Please complete all required fields.";
    $("parentMessage").classList.remove("hidden");
    return;
  }

  const studentName=`${first} ${last}`,parentName=`${parentFirst} ${parentLast}`,d=serviceDate();
  const proposedId=id();
  const rec={
    id:id(),studentId:proposedId,
    studentFirstName:first,studentLastName:last,firstName:first,lastName:last,studentName,
    parentFirstName:parentFirst,parentLastName:parentLast,parentFirst,parentLast,parentName,
    email,phone,age,grade,allergies,foodAllergies:allergies,
    photoPermission,photoConsent:photoPermission,emergencyPermission,transportConsent:emergencyPermission,
    group:teacherGroup(grade),date:d,checkedInBy:"Parent/Guardian",checkedInAt:new Date().toISOString(),present:false
  };

  try{
    $("parentMessage").textContent=`Saving ${studentName}…`;
    $("parentMessage").classList.remove("hidden");
    let result=await sync({action:"checkin",record:rec});

    if(result?.needsReview){
      const candidates=result.candidates||[];
      if(candidates.length===1){
        const c=candidates[0];
        const same=confirm(`We found a possible existing student: ${c.studentName} (${c.grade||c.group||"same class"}). Is this the same student?`);
        if(same){
          rec.studentId=c.studentId;
          result=await sync({action:"checkin",record:rec,forceStudentId:true});
        }else{
          rec.studentId=proposedId;
          result=await sync({action:"checkin",record:rec,allowNew:true});
        }
      }else{
        $("parentMessage").textContent="We found more than one possible existing student. Please ask an Admin to merge/review the records before registering this student.";
        return;
      }
    }

    if(result && result.studentSaved===false)throw new Error("The weekly check-in saved, but the permanent student profile did not save.");
    const effectiveId=result?.effectiveStudentId||rec.studentId;
    rec.studentId=effectiveId;
    if(result && result.present!==undefined)rec.present=!!result.present;

    // Reconcile local cache to the authoritative ID returned by Google Sheets.
    state.students=state.students.filter(s=>String(s.studentId)!==String(proposedId)&&String(s.studentId)!==String(effectiveId));
    state.students.push({studentId:effectiveId,studentName,firstName:first,lastName:last,parentName,parentFirst,parentLast,email,phone,age,grade,allergies,photoPermission,emergencyPermission,group:rec.group});
    state.roster=state.roster.filter(r=>String(r.studentId)!==String(proposedId)&&String(r.studentId)!==String(effectiveId));
    state.roster.push({studentId:effectiveId,studentName,firstName:first,lastName:last,grade,group:rec.group});
    state.records=state.records.filter(r=>!(String(r.studentId)===String(effectiveId)&&r.date===d&&r.checkedInAt));
    state.records.push(rec);
    save();
    sharedLoadedAt=0;

    $("parentMessage").textContent=result?.alreadyCheckedIn?`${studentName} is already checked in.`:(result?.matchedExisting?`${studentName} checked in and was matched to the existing student record.`:`${studentName} checked in.`);
    v14ShowParentSuccess(studentName,d,effectiveId,"registration",!!result?.alreadyCheckedIn);
    e.target.reset();
    formatPhone($("phone"));
  }catch(err){
    $("parentMessage").textContent=`Check-in could not fully save: ${err.message||err}`;
    $("parentMessage").classList.remove("hidden");
    console.error(err);
  }
});


async function refreshReturningResults(){
  const q=$("lookupLastName")?.value.trim()||"";
  if(!q){
    if($("familyResults"))$("familyResults").innerHTML="";
    returningLookup.clear();
    return;
  }
  const d=serviceDate();
  const lookupLoading=!(document.getElementById("parentSuccessPanel") && !document.getElementById("parentSuccessPanel").classList.contains("hidden"));
  if(lookupLoading)showLoading("Finding students…","Searching registered students");
  try{
  let found=[],lookupError="";
  if($("familyResults"))$("familyResults").innerHTML='<div class="lookup-loading"><span class="mini-spinner" aria-hidden="true"></span><span>Searching registered students…</span></div>';
  if(CONFIG.googleAppsScriptUrl){
    try{
      const data=await apiPost({action:"parentLookup",lastName:q,date:d});
      if(!data.ok)throw new Error(data.error||"Unable to search registered students.");
      found=data.students||[];
    }catch(e){lookupError=e.message||"Unable to search registered students.";console.warn("Returning Student lookup failed",e)}
  }else{
    const lower=q.toLowerCase();
    found=state.students.filter(s=>(s.lastName||s.studentName.split(/\s+/).pop()||"").toLowerCase()===lower).map(s=>({...s,checkedIn:!!state.records.find(r=>r.studentId===s.studentId&&r.date===d&&!!r.checkedInAt)}));
  }
  returningLookup=new Map(found.map(s=>[String(s.studentId),s]));
  if(lookupError){
    $("familyResults").innerHTML=`<p class="message">${esc(lookupError)} Please try again.</p>`;
    return;
  }
  $("familyResults").innerHTML=found.length?found.map(s=>`<div class="card">
      <strong>${esc(s.studentName)}</strong>
      <div class="muted">${esc(s.grade)} · ${esc(s.age)}</div>
      ${s.checkedIn
        ? `<button type="button" disabled>Checked In</button>`
        : `<button class="primary" type="button" onclick="returnCheckin('${esc(s.studentId)}')">Check In</button>`}
    </div>`).join(""):`<div class="card"><p>No registered students were found for that last name.</p><button type="button" class="primary" onclick="v14RegisterFromLookup()">Would you like to register this student?</button></div>`;
  }finally{if(lookupLoading)hideLoading();}
}
window.v14RegisterFromLookup=()=>{
  const last=$("lookupLastName").value.trim();
  v14ParentPath("register");
  $("parentForm").reset();
  formatPhone($("phone"));
  $("parentMessage").classList.add("hidden");
  if(last)$("studentLastName").value=last;
  $("studentFirstName").focus();
};
$("lookupFamily").addEventListener("click",refreshReturningResults);

window.returnCheckin=async sid=>{
  const d=serviceDate();
  const info=returningLookup.get(String(sid));
  showLoading("Checking in student…","Saving to Ira Baptist check-in");
  try{
    if(CONFIG.googleAppsScriptUrl){
      const result=await apiPost({action:"returnCheckin",studentId:sid,date:d});
      if(!result.ok)throw new Error(result.error||"Check-in failed.");
      $("parentMessage").textContent=result.alreadyCheckedIn?`${result.studentName||info?.studentName||"Student"} is already checked in.`:`${result.studentName||info?.studentName||"Student"} checked in.`;
    }else{
      const s=state.students.find(x=>x.studentId===sid);
      if(!s)return;
      if(!state.records.some(r=>r.studentId===sid&&r.date===d)){
        state.records.push({id:id(),...s,date:d,checkedInBy:"Parent/Guardian",checkedInAt:new Date().toISOString(),present:false});
        save();
      }
      $("parentMessage").textContent=`${s.studentName} checked in.`;
    }
    $("parentMessage").classList.remove("hidden");
    await refreshReturningResults();
  }catch(e){
    $("parentMessage").textContent=e.message||"Unable to check in. Please try again.";
    $("parentMessage").classList.remove("hidden");
  }finally{
    hideLoading();
  }
};


window.openEditStudent=studentId=>{
  const s=studentProfile(studentId);
  if(!s?.studentId)return;
  $("editStudentId").value=s.studentId;
  $("editStudentFirstName").value=s.firstName||((s.studentName||"").trim().split(/\s+/)[0]||"");
  $("editStudentLastName").value=s.lastName||((s.studentName||"").trim().split(/\s+/).slice(1).join(" ")||"");
  $("editParentFirstName").value=s.parentFirst||((s.parentName||"").trim().split(/\s+/)[0]||"");
  $("editParentLastName").value=s.parentLast||((s.parentName||"").trim().split(/\s+/).slice(1).join(" ")||"");
  $("editStudentEmail").value=s.email||"";
  $("editStudentPhone").value=s.phone||"";
  formatPhone($("editStudentPhone"));
  $("editStudentGrade").value=s.grade||"";
  $("editStudentAge").value=s.age||"";
  $("editStudentAllergies").value=s.allergies||"";
  $("editPhotoPermission").checked=!!s.photoPermission;
  $("editEmergencyPermission").checked=!!s.emergencyPermission;
  $("editStudentModal").classList.remove("hidden");
};
window.closeEditStudent=()=>$("editStudentModal")?.classList.add("hidden");

$("editStudentPhone")?.addEventListener("input",()=>formatPhone($("editStudentPhone")));
$("editStudentForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const studentId=$("editStudentId").value;
  const firstName=$("editStudentFirstName").value.trim();
  const lastName=$("editStudentLastName").value.trim();
  const parentFirst=$("editParentFirstName").value.trim();
  const parentLast=$("editParentLastName").value.trim();
  const email=$("editStudentEmail").value.trim();
  const phone=$("editStudentPhone").value.trim();
  const digits=phone.replace(/\D/g,"");
  const grade=$("editStudentGrade").value;
  const age=$("editStudentAge").value;
  if(!studentId||!firstName||!lastName||!parentFirst||!parentLast||!email||digits.length!==10||!grade||!age){
    $("editStudentMessage").textContent=digits.length!==10?"Please enter a complete 10-digit phone number.":"Please complete all required fields.";
    $("editStudentMessage").classList.remove("hidden");
    return;
  }
  const studentName=`${firstName} ${lastName}`;
  const parentName=`${parentFirst} ${parentLast}`;
  const group=teacherGroup(grade);
  const updates={
    studentId,studentName,firstName,lastName,parentName,parentFirst,parentLast,
    email,phone,grade,age,group,
    allergies:$("editStudentAllergies").value.trim(),
    photoPermission:$("editPhotoPermission").checked,
    emergencyPermission:$("editEmergencyPermission").checked
  };

  const existing=state.students.find(x=>x.studentId===studentId);
  if(existing)Object.assign(existing,updates);
  else state.students.push({...updates});

  state.roster.forEach(r=>{
    if(r.studentId===studentId)Object.assign(r,{studentName,firstName,lastName,grade,group});
  });
  if(!state.roster.some(r=>r.studentId===studentId)){
    state.roster.push({studentId,studentName,firstName,lastName,grade,group});
  }

  // Update the student's identifying/profile information on historical weekly records too.
  // Attendance and check-in dates/statuses are intentionally left unchanged.
  state.records.forEach(r=>{
    if(r.studentId===studentId)Object.assign(r,updates);
  });

  save();
  await sync({action:"updateStudent",student:updates});
  $("editStudentMessage").classList.add("hidden");
  closeEditStudent();
  refreshReturningResults();
  renderTeacher();
  renderAdmin();
});

window.deleteStudentRecord=async studentId=>{
  const profile=studentProfile(studentId);
  const name=profile.studentName||"this student";
  if(!confirm(`Remove ${name} from the active student/roster lists? Historical attendance will be preserved.`))return;

  state.students.forEach(s=>{if(s.studentId===studentId)s.activeRoster=false});
  state.roster.forEach(r=>{if(r.studentId===studentId)r.activeRoster=false});
  save();
  await sync({action:"deleteStudent",studentId});
  refreshReturningResults();
  renderTeacher();
  renderAdmin();
};

$("adminSort")?.addEventListener("change",renderAdmin);
let v14LastServiceDate=currentServiceDate()||dates()[0]||"";
function v14ChangeWeek(sourceId){
  const el=$(sourceId);if(!el)return;
  const next=el.value,previous=v14LastServiceDate||next;
  if(v14HasPending()&&!confirm("You have unsaved changes. Change weeks without saving them?")){
    el.value=previous;return;
  }
  v14LastServiceDate=next;setServiceWeek(next,sourceId);v14RememberLocation();
  if(sourceId==="parentDate")refreshReturningResults().catch(e=>console.warn("Lookup refresh failed",e));
  renderTeacher();renderAdmin();if($("kitchen")?.classList.contains("active"))v14RenderKitchen();
}
$("parentDate")?.addEventListener("change",()=>v14ChangeWeek("parentDate"));
$("teacherDate")?.addEventListener("change",()=>v14ChangeWeek("teacherDate"));
$("adminDate")?.addEventListener("change",()=>v14ChangeWeek("adminDate"));

document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",async()=>{
  const view=b.dataset.view;
  if(!(await ensureAccess(view)))return;
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  $(view).classList.add("active");
  if(view==="teacher")renderTeacher();
  if(view==="admin")renderAdmin();
  v14RememberLocation();
}));

document.querySelectorAll(".teacher-tab").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".teacher-tab").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  activeGroup=b.dataset.group;
  renderTeacher();
  v14RememberLocation();
}));

$("teacherForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const firstName=$("teacherFirstName").value.trim();
  const lastName=$("teacherLastName").value.trim();
  const group=$("teacherClass").value;
  if(!firstName||!lastName||!group)return;
  state.teachers[group]??=[];
  const t={id:id(),firstName,lastName,group,role:$("teacherRole").value,allergies:$("teacherAllergies")?.value.trim()||""};
  state.teachers[group].push(t);
  save();
  await sync({action:"addTeacher",teacher:t,name:`${firstName} ${lastName}`,group});
  e.target.reset();
  activeGroup=group;
  document.querySelectorAll(".teacher-tab").forEach(x=>x.classList.toggle("active",x.dataset.group===group));
  renderTeacher();
});

$("rosterForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const first=$("rosterFirstName").value.trim(),last=$("rosterLastName").value.trim(),grade=$("rosterGrade").value;
  if(!first||!last||!grade)return;
  const student={studentId:id(),studentName:`${first} ${last}`,firstName:first,lastName:last,grade,group:teacherGroup(grade),allergies:$("rosterAllergies").value.trim()};
  let saved=false;
  showLoading("Saving roster student…","Saving the profile and food allergies");
  try{
    const result=await sync({action:"addRosterStudent",student});
    saved=true;
    await v14Refresh();
    $("rosterMessage").textContent=result.alreadyExists?`${student.studentName} was found and its roster information was updated.`:`${student.studentName} was added.`;
    $("rosterMessage").classList.remove("hidden");
    e.target.reset();
  }catch(err){
    $("rosterMessage").textContent=saved?"The student was saved, but the roster could not refresh. Please refresh the page.":"Student was not saved: "+(err.message||err);
    $("rosterMessage").classList.remove("hidden");
  }finally{hideLoading();}
});

$("volunteerForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const first=$("volunteerFirstName").value.trim();
  const last=$("volunteerLastName").value.trim();
  const name=`${first} ${last}`.trim();
  if(!first||!last)return;
  if(state.volunteers.some(v=>(v.name||"").toLowerCase()===name.toLowerCase()))return;

  const v={id:id(),firstName:first,lastName:last,name,allergies:$("volunteerAllergies")?.value.trim()||""};
  state.volunteers.push(v);
  save();
  await sync({action:"addVolunteer",volunteer:v});
  $("volunteerMessage").textContent=`${name} was added and will appear on future weeks.`;
  $("volunteerMessage").classList.remove("hidden");
  e.target.reset();
  renderVolunteers();
});

$("saveNotes").addEventListener("click",async()=>{
  const d=selectedDate();
  state.notes[d]=$("dailyNotes").value;
  save();
  await sync({action:"saveNotes",date:d,notes:state.notes[d]});
  $("notesMessage").textContent="Notes saved. The graph marker and tooltip were updated for this service date.";
  $("notesMessage").classList.remove("hidden");
  renderChart();
});

$("deleteWeek").addEventListener("click",async()=>{
  const d=selectedDate();
  if(!v14GuardPendingForWeek())return;
  if(!confirm(`Remove ${fmt(d)} from the weekly calendar? This does not delete old attendance records.`))return;
  let saved=false;
  showLoading("Removing service week…","Preserving historical records");
  try{
    await sync({action:"deleteWeek",date:d});saved=true;
    const token=sessionStorage.getItem(SESSION_KEYS.admin);
    await loadSharedState(token);
    const next=currentServiceDate()||dates()[0]||"";
    setServiceWeek(next);v14LastServiceDate=next;
    renderTeacher();renderAdmin();v14RememberLocation();
    v14Notice("weekMessage","Week removed from the calendar. Historical records were preserved.");
  }catch(e){v14Notice("weekMessage",saved?"The week was removed, but the calendar could not refresh. Please refresh.":e.message);}
  finally{hideLoading();}
});

function initLogo(){
  const logo=$("logo");
  if(logo)logo.src="logo.png";
}

function initApp(){
  initLogo();
  ensureLoadingUi();

  // Populate the Wednesday selector immediately from local configuration.
  // Google Sheets calendar refresh happens afterward and no longer delays dates.
  populateDates();
  renderTeacher();
  renderAdmin();
  if($("connectionStatus"))$("connectionStatus").textContent="Connecting…";

  return loadPublicCalendar()
    .then(()=>{
      populateDates();
      renderTeacher();
      renderAdmin();
      if($("connectionStatus"))$("connectionStatus").textContent="Google Sheets ready";
    })
    .catch(()=>{
      if($("connectionStatus"))$("connectionStatus").textContent="Calendar sync delayed";
    });
}


/* V14 consolidated Teacher / Registration UI */
const V14_GROUPS=["PreK-K","1st-2nd","3rd","4th","5th","Youth","Adults"];
const V14_LOCATION_KEY="iraBaptistV14PageLocation";
function v14ReadLocation(){
  try{return JSON.parse(sessionStorage.getItem(V14_LOCATION_KEY)||"{}")||{}}catch(e){return {}}
}
const v14InitialLocation=v14ReadLocation();
let v14PageState={...v14InitialLocation},v14LocationReady=false;
function v14RememberLocation(){
  if(!v14LocationReady)return;
  const active=document.querySelector(".view.active");
  v14PageState.view=active?.id||"parent";
  v14PageState.group=activeGroup;
  v14PageState.week=$("adminDate")?.value||"";
  v14PageState.kitchenWeek=$("kitchenDate")?.value||"";
  sessionStorage.setItem(V14_LOCATION_KEY,JSON.stringify(v14PageState));
}
async function v14RestoreLocation(){
  const saved=v14InitialLocation;
  if(saved.group&&V14_GROUPS.includes(saved.group))activeGroup=saved.group;
  const ds=dates();
  const selected=ds.includes(saved.week)?saved.week:(currentServiceDate()||ds[0]);
  if(selected){setServiceWeek(selected);v14LastServiceDate=selected;}
  if(saved.parentPath==="register"||saved.parentPath==="checkin")v14ParentPath(saved.parentPath);
  else if(saved.parentPath==="success"&&saved.success?.name){
    const s=saved.success;
    v14ShowParentSuccess(s.name,s.date,s.studentId,s.type,s.already);
  }else v14ParentPath("home");
  const view=["parent","teacher","admin","kitchen"].includes(saved.view)?saved.view:"parent";
  if(view==="teacher"||view==="admin"){
    if(!(await ensureAccess(view))){
      v14ParentPath("home");
      v14LocationReady=true;v14RememberLocation();return;
    }
  }
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===view));
  document.querySelectorAll(".teacher-tab").forEach(b=>b.classList.toggle("active",b.dataset.group===activeGroup));
  if(view==="kitchen")await v14LoadKitchen();
  if(view==="teacher")renderTeacher();
  if(view==="admin")renderAdmin();
  v14LocationReady=true;v14RememberLocation();
}
function v14ParentPath(path){
  v14PageState.parentPath=path;v14PageState.success=null;
  $("parentSuccessPanel")?.classList.add("hidden");
  const home=path==="home";
  $("parentHome").hidden=!home;$("parentWorkflow").hidden=home;
  $("returningPanel").hidden=path!=="checkin";
  $("registrationPanel").hidden=path!=="register";
  $("parentWorkflowTitle").textContent=path==="register"?"Register Student":"Check In a Student";
  if(path==="checkin")$("lookupLastName").focus();
  v14RememberLocation();
}
document.querySelectorAll("[data-parent-path]").forEach(b=>b.addEventListener("click",()=>v14ParentPath(b.dataset.parentPath)));
$("parentBack").addEventListener("click",()=>v14ParentPath("home"));
document.querySelector('[data-view="parent"]').addEventListener("click",()=>v14ParentPath("home"));
v14ParentPath("home");
function v14Notice(id,message){const el=$(id);if(el){el.textContent=message;el.classList.remove("hidden");}}
function v14TeacherById(tid){return Object.values(state.teachers).flat().find(t=>String(t.id||t.teacherId)===String(tid));}
function v14GroupOptions(select,value){
  select.innerHTML=V14_GROUPS.map(g=>`<option value="${esc(g)}">${esc(g==="Adults"?"Adults Class":g)}</option>`).join("");
  select.value=value||activeGroup;
}
function v14GradeOptions(select,value){
  select.innerHTML=$("rosterGrade").innerHTML;
  select.value=value||"";
}
function v14Close(id){$(id).classList.add("hidden");}
document.querySelectorAll("[data-close-v14]").forEach(b=>b.addEventListener("click",()=>v14Close(b.dataset.closeV14)));
window.v14EditTeacher=tid=>{
  const t=v14TeacherById(tid);if(!t)return;
  $("v14TeacherId").value=tid;$("v14TeacherFirst").value=t.firstName||"";
  $("v14TeacherLast").value=t.lastName||"";v14GroupOptions($("v14TeacherGroup"),t.group);
  $("v14TeacherRole").value=t.role||"Main Classroom Teacher";$("v14TeacherAllergies").value=t.allergies||"";
  $("v14TeacherModal").classList.remove("hidden");
};
async function v14Refresh(role="teacher"){
  const token=sessionStorage.getItem(SESSION_KEYS.admin)||sessionStorage.getItem(SESSION_KEYS.teacher)||"";
  if(!token)throw new Error("Your session has expired. Please sign in again.");
  await loadSharedState(token);
  renderTeacher();renderAdmin();
}
$("v14TeacherEditForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const teacher={id:$("v14TeacherId").value,firstName:$("v14TeacherFirst").value.trim(),lastName:$("v14TeacherLast").value.trim(),group:$("v14TeacherGroup").value,role:$("v14TeacherRole").value,allergies:$("v14TeacherAllergies").value.trim()};
  if(!teacher.firstName||!teacher.lastName)return;
  try{
    await sync({action:"updateTeacher",teacher});
    Object.values(state.teachers).flat().forEach(t=>{if(String(t.id||t.teacherId)===String(teacher.id))Object.assign(t,teacher);});
    v14Close("v14TeacherModal");renderTeacher();renderAdmin();
    v14Notice("teacherManageMessage","Teacher saved.");v14Notice("adminTeacherMessage","Teacher saved.");
    v14Refresh().catch(err=>console.warn("Background refresh after teacher edit failed",err));
  }catch(err){v14Notice("teacherManageMessage","Teacher was not saved: "+err.message);}
});
window.v14RemoveTeacher=async tid=>{
  const t=v14TeacherById(tid);if(!t)return;
  if(!confirm(`Remove ${teacherName(t)} from the active teacher list? Historical attendance will be preserved.`))return;
  try{await sync({action:"removeTeacher",teacherId:tid});await v14Refresh();v14Notice("teacherManageMessage","Teacher removed. Historical attendance was preserved.");}
  catch(err){v14Notice("teacherManageMessage","Teacher was not removed: "+err.message);}
};
window.v14EditRoster=sid=>{
  const p=studentProfile(sid);if(!p.studentId)return;
  $("v14RosterId").value=sid;
  $("v14RosterFirst").value=p.firstName||p.studentName.split(/\s+/)[0]||"";
  $("v14RosterLast").value=p.lastName||p.studentName.split(/\s+/).slice(1).join(" ")||"";
  v14GradeOptions($("v14RosterGrade"),p.grade);
  $("v14RosterAllergies").value=p.allergies||"";
  $("v14RosterModal").classList.remove("hidden");
};
$("v14RosterEditForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const student={studentId:$("v14RosterId").value,firstName:$("v14RosterFirst").value.trim(),lastName:$("v14RosterLast").value.trim(),grade:$("v14RosterGrade").value,allergies:$("v14RosterAllergies").value.trim()};
  if(!student.firstName||!student.lastName||!student.grade)return;
  student.studentName=student.firstName+" "+student.lastName;
  student.group=teacherGroup(student.grade);
  try{
    await sync({action:"updateRosterProfile",student});
    [...state.students,...state.roster].forEach(x=>{if(String(x.studentId)===String(student.studentId)){x.firstName=student.firstName;x.lastName=student.lastName;x.studentName=student.studentName;x.grade=student.grade;x.group=student.group;x.allergies=student.allergies;}});
    v14Close("v14RosterModal");renderTeacher();renderAdmin();v14Notice("teacherStudentMessage","Student saved. Registration and permissions were preserved.");
    v14Refresh().catch(err=>console.warn("Background refresh after roster edit failed",err));
  }catch(err){v14Notice("teacherStudentMessage","Student was not saved: "+err.message);}
});
window.v14RemoveRoster=async sid=>{
  const p=studentProfile(sid);
  if(!confirm(`Remove ${p.studentName} from the active roster? Registration and all historical attendance will be preserved.`))return;
  try{
    await sync({action:"removeRosterStudent",studentId:sid});
    state.roster.forEach(x=>{if(String(x.studentId)===String(sid))x.activeRoster=false;});
    renderTeacher();renderAdmin();v14Notice("teacherStudentMessage","Student removed from the active roster. Registration and history were preserved.");
    v14Refresh().catch(err=>console.warn("Background refresh after roster removal failed",err));
  }catch(err){v14Notice("teacherStudentMessage","Student was not removed: "+err.message);}
};

function v14RenderAdminTeachers(){
  const target=$("adminTeacherManagement");if(!target)return;
  const teachers=Object.values(state.teachers).flat();
  target.innerHTML=teachers.length?teachers.map(t=>`<div class="teacher-person"><div class="person-name"><strong>${esc(teacherName(t))}</strong><div class="role-label">${esc(t.group)} · ${esc(t.role||"Main Classroom Teacher")}</div></div><div class="record-actions"><button type="button" class="small" onclick="v14EditTeacher('${esc(t.id)}')">Edit</button><button type="button" class="small" onclick="v14RemoveTeacher('${esc(t.id)}')">Remove</button></div></div>`).join(""):"<p class='muted'>No active teachers.</p>";
}
const v14OriginalRenderAdmin=renderAdmin;
renderAdmin=function(){v14OriginalRenderAdmin();v14RenderAdminTeachers();};
const v14OriginalRenderTeacher=renderTeacher;
renderTeacher=function(){
  v14OriginalRenderTeacher();
  const d=$("teacherDate")?.value||dates()[0];
  const roster=new Map();
  state.roster.filter(p=>p.group===activeGroup&&p.activeRoster!==false).forEach(p=>{if(p.studentId)roster.set(String(p.studentId),p);});
  state.records.filter(r=>r.date===d&&r.group===activeGroup&&r.checkedInAt&&studentProfile(r.studentId).activeRoster!==false).forEach(p=>{if(p.studentId)roster.set(String(p.studentId),p);});
  const rows=[...roster.values()].map(p=>studentProfile(p.studentId)).filter(p=>p.activeRoster!==false).sort((a,b)=>(a.studentName||"").localeCompare(b.studentName||""));
  $("teacherTable").innerHTML=rows.length?`<div style="overflow-x:auto"><table><thead><tr><th>Student</th><th>Grade</th><th>Parent Check-In</th><th>Class Attendance</th><th>Roster</th></tr></thead><tbody>${rows.map(p=>{
    const present=v14EffectiveStudent(p.studentId,d)==="present";
    const checked=!!studentRecord(d,p.studentId)?.checkedInAt;
    const allergy=String(p.allergies||"").trim();
    return `<tr class="${v14PendingStudent[v14Key(d,p.studentId)]!==undefined?'pending-change':''}"><td><strong>${esc(p.studentName||"Unnamed student")}</strong>${allergy?`<span class="allergy-alert">Allergy: ${esc(allergy)}</span>`:"<span class='muted'>No allergy listed</span>"}</td><td>${esc(p.grade)}</td><td>${checked?"Checked In":"Not Checked In"}</td><td><button type="button" class="attendance-btn ${present?"attendance-present":"attendance-absent"}" onclick="setStudentAttendance('${esc(p.studentId)}','${d}','${present?"absent":"present"}')">${present?"Present":"Absent"}</button>${v14PendingStudent[v14Key(d,p.studentId)]!==undefined?` <span class="muted">Pending save</span>`:""}</td><td><div class="record-actions"><button type="button" class="small" onclick="v14EditRoster('${esc(p.studentId)}')">Edit</button></div></td></tr>`;
  }).join("")}</tbody></table></div>`:"<p class='muted'>No students in this group yet.</p>";
  const teachers=state.teachers[activeGroup]||[];
  $("teacherNames").textContent=teachers.map(teacherName).join(", ")||"No teachers added yet";
  $("teacherList").innerHTML=teachers.map(t=>{
    const tid=t.id||t.teacherId;const present=v14EffectiveTeacher(tid,d)==="present";const allergy=String(t.allergies||"").trim();
    return `<div class="teacher-person ${v14PendingTeacher[v14Key(d,tid)]!==undefined?'pending-change':''}"><div class="person-name"><strong>${esc(teacherName(t))}</strong><div class="role-label">${esc(t.role||"Main Classroom Teacher")}</div>${allergy?`<span class="allergy-alert">Allergy: ${esc(allergy)}</span>`:""}</div><button type="button" class="attendance-btn ${present?"attendance-present":"attendance-absent"}" onclick="setTeacherAttendance('${esc(tid)}','${d}','${present?"absent":"present"}')">${present?"Present":"Absent"}</button><div class="record-actions"><button type="button" class="small" onclick="v14EditTeacher('${esc(tid)}')">Edit</button><button type="button" class="small" onclick="v14RemoveTeacher('${esc(tid)}')">Remove</button></div></div>`;
  }).join("")||"<p class='muted'>No teachers added yet.</p>";
  v14UpdateFloatingSave();
};


/* =========================
   V14 COMPLETION — stability-first additions
========================= */
const v14PendingStudent={};
const v14PendingTeacher={};
const v14PendingVolunteer={};
let v14KitchenState=null;
function v14Key(date,idv){return `${date}::${idv}`}
function v14HasPending(){return Object.keys(v14PendingStudent).length||Object.keys(v14PendingTeacher).length||Object.keys(v14PendingVolunteer).length}
const V14_PENDING_KEY="iraBaptistV14PendingAttendance";
let v14BatchSaving=false;
function v14StorePending(){
  try{sessionStorage.setItem(V14_PENDING_KEY,JSON.stringify({students:v14PendingStudent,teachers:v14PendingTeacher,volunteers:v14PendingVolunteer}));}
  catch(e){console.warn("Pending attendance could not be stored",e);}
}
function v14RestorePending(){
  try{
    const p=JSON.parse(sessionStorage.getItem(V14_PENDING_KEY)||"{}");
    [["students",v14PendingStudent],["teachers",v14PendingTeacher],["volunteers",v14PendingVolunteer]].forEach(([name,target])=>{
      Object.entries(p[name]||{}).forEach(([key,value])=>{if(/^\d{4}-\d{2}-\d{2}::.+$/.test(key))target[key]=value;});
    });
  }catch(e){console.warn("Pending attendance could not be restored",e);}
}
function v14EnsureFloatingSave(){
  let b=$("v14FloatingSave");if(b)return b;
  b=document.createElement("button");b.id="v14FloatingSave";b.type="button";b.className="floating-save hidden";b.addEventListener("click",v14SavePending);document.body.appendChild(b);return b;
}
function v14UpdateFloatingSave(){
  const b=v14EnsureFloatingSave(),n=Object.keys(v14PendingStudent).length+Object.keys(v14PendingTeacher).length+Object.keys(v14PendingVolunteer).length;
  let w=$("v14PendingWarning");if(!w){w=document.createElement("div");w.id="v14PendingWarning";w.className="pending-warning hidden";w.setAttribute("role","status");document.body.appendChild(w);}
  b.innerHTML=v14BatchSaving?"Saving all changes…":n?`<span class="pending-dot"></span>Save ${n} Unsaved Change${n===1?"":"s"}`:"Save Changes";
  b.disabled=v14BatchSaving;
  w.textContent=n?`You have ${n} unsaved change${n===1?"":"s"}. Mark multiple people, then save them together. Changes are not final until saved.`:"";
  b.classList.toggle("hidden",!n);w.classList.toggle("hidden",!n);
  v14StorePending();
}
v14RestorePending();
window.addEventListener("beforeunload",e=>{if(v14HasPending()){e.preventDefault();e.returnValue="";}});
function v14AttendanceBatches(snapshot){
  const byDate=new Map();
  function add(type,idField,entries){
    Object.entries(entries).forEach(([key,value])=>{
      const split=key.indexOf("::"),date=key.slice(0,split),id=key.slice(split+2);
      if(!byDate.has(date))byDate.set(date,{date,students:[],teachers:[],volunteers:[]});
      byDate.get(date)[type].push(type==="volunteers"?{volunteerId:id,...value}:{[idField]:id,status:value});
    });
  }
  add("students","studentId",snapshot.students);add("teachers","teacherId",snapshot.teachers);add("volunteers","volunteerId",snapshot.volunteers);
  return [...byDate.values()];
}
async function v14SavePending(){
  if(v14BatchSaving||!v14HasPending())return;
  const snapshot={students:{...v14PendingStudent},teachers:{...v14PendingTeacher},volunteers:JSON.parse(JSON.stringify(v14PendingVolunteer))};
  const batches=v14AttendanceBatches(snapshot);
  v14BatchSaving=true;v14UpdateFloatingSave();
  showLoading("Saving all attendance changes…","Saving students, teachers and serving assignments together");
  let saved=false;
  try{
    const result=await sync({action:"saveAttendanceChangesBatch",batches});
    saved=true;
    for(const [name,target] of [["students",v14PendingStudent],["teachers",v14PendingTeacher],["volunteers",v14PendingVolunteer]]){
      Object.entries(snapshot[name]).forEach(([key,value])=>{if(JSON.stringify(target[key])===JSON.stringify(value))delete target[key];});
    }
    v14StorePending();
    // Reload authoritative records before announcing completion.
    const token=sessionStorage.getItem(SESSION_KEYS.admin)||sessionStorage.getItem(SESSION_KEYS.teacher);
    if(token)await loadSharedState(token);
    renderTeacher();renderAdmin();renderVolunteers();
    v14Notice($("admin")?.classList.contains("active")?"adminStudentMessage":"teacherStudentMessage",`${result.saved} attendance change${result.saved===1?"":"s"} saved successfully.`);
  }catch(err){
    // A failed refresh after a successful write must not resurrect the saved edits.
    const message=saved?"Changes saved, but the latest data could not load. Refresh to verify.":(err.message||"Unable to save attendance.");
    alert(message+(saved?"":"\n\nYour pending changes are retained so you can retry."));
  }finally{v14BatchSaving=false;hideLoading();v14UpdateFloatingSave();}
}
function v14EffectiveStudent(studentId,d){const p=v14PendingStudent[v14Key(d,studentId)];return p||(studentAttendance(studentId,d)==="present"?"present":"absent")}
function v14EffectiveTeacher(teacherId,d){const p=v14PendingTeacher[v14Key(d,teacherId)];return p||(teacherAttendance(teacherId,d)==="present"?"present":"absent")}
window.setStudentAttendance=(studentId,date,status)=>{
  if(v14BatchSaving)return;
  v14PendingStudent[v14Key(date,studentId)]=status==="present"?"present":"absent";
  v14UpdateFloatingSave();renderTeacher();renderAdmin();
};
window.setTeacherAttendance=(teacherId,date,status)=>{
  if(v14BatchSaving)return;
  v14PendingTeacher[v14Key(date,teacherId)]=status==="present"?"present":"absent";
  v14UpdateFloatingSave();renderTeacher();renderAdmin();
};
function v14EffectiveVolunteer(idv,d){
  return v14PendingVolunteer[v14Key(d,idv)]||(state.volunteerSchedule[d]||{})[idv]||{serving:false,area:"",other:"",present:false};
}
function v14StageVolunteer(idv,patch){
  if(v14BatchSaving)return;
  const d=selectedDate(),x={...v14EffectiveVolunteer(idv,d),...patch};
  if(!x.serving){x.area="";x.other="";}
  v14PendingVolunteer[v14Key(d,idv)]=x;
  v14UpdateFloatingSave();renderVolunteers();renderAdmin();
}
window.toggleVolunteerPresent=idv=>{const x=v14EffectiveVolunteer(idv,selectedDate());v14StageVolunteer(idv,{present:!x.present})};
window.toggleVolunteer=idv=>{const x=v14EffectiveVolunteer(idv,selectedDate());v14StageVolunteer(idv,{serving:!x.serving})};
window.setVolunteerArea=(idv,a)=>v14StageVolunteer(idv,{serving:true,area:a,other:a==="Other"?v14EffectiveVolunteer(idv,selectedDate()).other:""});
window.setVolunteerOther=(idv,o)=>v14StageVolunteer(idv,{serving:true,area:"Other",other:o});

function v14ShowParentSuccess(name,date,studentId,type,already){
  const panel=$("parentSuccessPanel");if(!panel)return;
  $("parentHome").hidden=true;$("parentWorkflow").hidden=true;
  panel.innerHTML=`<h3>${already?"Already checked in":"Check-In Complete"}</h3><div class="success-name"><strong>${esc(name)}</strong></div><div>${esc(fmt(date))}</div><div class="success-actions"><button type="button" class="primary" onclick="v14CheckInAnother()">Check In Another Student</button><button type="button" class="primary" onclick="v14RegisterAnother()">Register Another Student</button><button type="button" class="primary" onclick="v14ParentPath('home')">Back to Home</button>${studentId?`<button type="button" onclick="v14UndoCheckin('${esc(studentId)}','${esc(date)}','${esc(name)}')">Undo Check-In</button>`:""}</div>`;
  panel.classList.remove("hidden");panel.scrollIntoView({behavior:"smooth",block:"start"});
  v14PageState.parentPath="success";v14PageState.success={name,date,studentId,type,already};
  v14RememberLocation();
}
window.v14CheckInAnother=()=>{v14ParentPath("checkin");$("lookupLastName").value="";$("familyResults").innerHTML="";returningLookup.clear();$("lookupLastName").focus();};
window.v14RegisterAnother=()=>{v14ParentPath("register");$("parentForm").reset();formatPhone($("phone"));$("parentMessage").classList.add("hidden");$("studentFirstName").focus();};
window.v14UndoCheckin=async(studentId,date,name)=>{
  if(!confirm(`Undo the parent check-in for ${name} on ${fmt(date)}? Classroom attendance and registration will be preserved.`))return;
  try{const r=await apiPost({action:"undoParentCheckin",studentId,date});if(!r.ok)throw new Error(r.error||"Undo failed.");const rec=state.records.find(x=>String(x.studentId)===String(studentId)&&x.date===date);if(rec)rec.checkedInAt="";save();$("parentSuccessPanel").classList.add("hidden");$("parentMessage").textContent=`${name}'s parent check-in was undone. Classroom attendance was not changed.`;$("parentMessage").classList.remove("hidden");await refreshReturningResults();}catch(e){alert(e.message||"Unable to undo check-in.");}
};
window.returnCheckin=async sid=>{
  const d=serviceDate(),info=returningLookup.get(String(sid));
  showLoading("Checking in student…","Saving to Ira Baptist check-in");
  try{
    const result=await apiPost({action:"returnCheckin",studentId:sid,date:d});
    if(!result.ok)throw new Error(result.error||"Check-in failed.");
    const name=result.studentName||info?.studentName||"Student";
    $("parentMessage").textContent=result.alreadyCheckedIn?`${name} is already checked in.`:`${name} checked in.`;
    $("parentMessage").classList.remove("hidden");
    v14ShowParentSuccess(name,d,sid,"returning",!!result.alreadyCheckedIn);
    /* The success panel is authoritative; no secondary lookup is required here. */
  }catch(e){
    $("parentMessage").textContent=e.message||"Unable to check in. Please try again.";
    $("parentMessage").classList.remove("hidden");
  }finally{hideLoading();}
};


function v14SortText(v){return textValue(v).trim().toLocaleLowerCase();}
function v14CompareText(a,b){return v14SortText(a).localeCompare(v14SortText(b));}
function v14TeacherRows(){return Object.values(state.teachers).flat()}
function v14VolunteerById(idv){return state.volunteers.find(v=>String(v.id)===String(idv))}
function v14Actions(type,idv){return `<div class="record-actions"><button type="button" class="small" onclick="${type==='teacher'?'v14EditTeacher':'v14EditVolunteer'}('${esc(idv)}')">Edit</button><button type="button" class="small" onclick="v14OpenAdultMerge('${type}','${esc(idv)}')">Merge</button><button type="button" class="danger small" onclick="${type==='teacher'?'v14RemoveTeacher':'v14RemoveVolunteer'}('${esc(idv)}')">Remove</button></div>`}
function v14RenderAdminTeachers(){
  const target=$("adminTeacherManagement");if(!target)return;const d=selectedDate();let items=v14TeacherRows();const q=($("teacherSearch")?.value||"").toLowerCase();if(q)items=items.filter(t=>teacherName(t).toLowerCase().includes(q)||(t.group||"").toLowerCase().includes(q));const sort=$("teacherSort")?.value||"class";items.sort((a,b)=>sort==="name"?teacherName(a).localeCompare(teacherName(b)):sort==="role"?v14CompareText(a.role,b.role)||teacherName(a).localeCompare(teacherName(b)):sort==="allergy"?(!!b.allergies-!!a.allergies)||teacherName(a).localeCompare(teacherName(b)):v14CompareText(a.group,b.group)||teacherName(a).localeCompare(teacherName(b)));
  target.innerHTML=items.length?items.map(t=>{const tid=t.id||t.teacherId,p=v14EffectiveTeacher(tid,d)==="present",pending=v14PendingTeacher[v14Key(d,tid)]!==undefined;return `<div class="adult-row ${pending?'pending-change':''}"><div><strong>${esc(teacherName(t))}</strong><div class="role-label">${esc(t.group)} · ${esc(t.role||"Main Classroom Teacher")}</div>${t.allergies?`<span class="allergy-alert">Allergy: ${esc(t.allergies)}</span>`:""}</div><button type="button" class="attendance-btn ${p?'attendance-present':'attendance-absent'}" onclick="setTeacherAttendance('${esc(tid)}','${d}','${p?'absent':'present'}')">${p?'Present':'Absent'}</button><div>${pending?'<span class="muted">Pending save</span>':''}</div>${v14Actions('teacher',tid)}</div>`}).join(""):"<p class='muted'>No active teachers.</p>";
}
function renderVolunteers(){
  const target=$("volunteerTable");if(!target)return;const d=selectedDate(),sch=state.volunteerSchedule[d]||{};let items=[...state.volunteers];const q=($("volunteerSearch")?.value||"").toLowerCase();if(q)items=items.filter(v=>`${v.firstName} ${v.lastName}`.toLowerCase().includes(q));const mode=$("volunteerSort")?.value||"name";const status=v=>sch[v.id]||{};items.sort((a,b)=>mode==="serving"?(!!status(b).serving-!!status(a).serving)||v14CompareText(a.lastName,b.lastName):mode==="present"?(!!status(b).present-!!status(a).present)||v14CompareText(a.lastName,b.lastName):mode==="allergy"?(!!b.allergies-!!a.allergies)||v14CompareText(a.lastName,b.lastName):v14CompareText(a.lastName,b.lastName)||v14CompareText(a.firstName,b.firstName));const areas=["Kitchen","PreK-K","1st-2nd","3rd","4th","5th","Youth","Adults Class","Other"];
  target.innerHTML=items.length?items.map(v=>{const x=v14EffectiveVolunteer(v.id,d),pending=v14PendingVolunteer[v14Key(d,v.id)]!==undefined;return `<div class="adult-row ${pending?'pending-change':''}"><div><strong>${esc(v.firstName)} ${esc(v.lastName)}</strong>${v.allergies?`<span class="allergy-alert">Allergy: ${esc(v.allergies)}</span>`:""}</div><div><button type="button" class="attendance-btn ${x.present?'attendance-present':'attendance-absent'}" onclick="toggleVolunteerPresent('${esc(v.id)}')">${x.present?'Present':'Absent'}</button><button type="button" class="small ${x.serving?'primary':''}" onclick="toggleVolunteer('${esc(v.id)}')">${x.serving?'Serving':'Not Serving'}</button></div><div><select onchange="setVolunteerArea('${esc(v.id)}',this.value)" ${x.serving?'':'disabled'}><option value="">Select area</option>${areas.map(a=>`<option value="${esc(a)}" ${x.area===a?'selected':''}>${esc(a)}</option>`).join("")}</select>${x.area==="Other"?`<input value="${esc(x.other||'')}" onchange="setVolunteerOther('${esc(v.id)}',this.value)" placeholder="Other location">`:''}${pending?'<div class="muted">Pending save</div>':''}</div>${v14Actions('volunteer',v.id)}</div>`}).join(""):"<p class='muted'>No volunteers added yet.</p>";
}
window.v14EditVolunteer=idv=>{const v=v14VolunteerById(idv);if(!v)return;$("v14VolunteerId").value=v.id;$("v14VolunteerFirst").value=v.firstName||"";$("v14VolunteerLast").value=v.lastName||"";$("v14VolunteerAllergies").value=v.allergies||"";$("v14VolunteerModal").classList.remove("hidden")};
$("v14VolunteerEditForm")?.addEventListener("submit",async e=>{e.preventDefault();const volunteer={id:$("v14VolunteerId").value,firstName:$("v14VolunteerFirst").value.trim(),lastName:$("v14VolunteerLast").value.trim(),allergies:$("v14VolunteerAllergies").value.trim()};try{await sync({action:"updateVolunteer",volunteer});v14Close("v14VolunteerModal");await v14Refresh("admin");v14Notice("volunteerMessage","Volunteer saved.");}catch(err){v14Notice("volunteerMessage","Volunteer was not saved: "+err.message)}});
window.v14RemoveVolunteer=async idv=>{const v=v14VolunteerById(idv);if(!v)return;if(!confirm(`Remove ${v.firstName} ${v.lastName} from the active volunteer list? Historical serving and attendance will be preserved.`))return;showLoading("Removing volunteer…","Preserving historical attendance and serving records");try{const token=sessionStorage.getItem(SESSION_KEYS.admin)||"";const r=await apiPost({action:"removeVolunteer",volunteerId:idv,token});if(!r.ok)throw new Error(r.error||"Remove failed.");state.volunteers=state.volunteers.filter(x=>String(x.id)!==String(idv));renderVolunteers();renderAdmin();await loadSharedState(token);v14Notice("volunteerMessage","Volunteer removed. History was preserved.");}catch(e){v14Notice("volunteerMessage",e.message)}finally{hideLoading();}};
window.v14OpenAdultMerge=(type,idv)=>{const list=type==="teacher"?v14TeacherRows():state.volunteers,primary=list.find(x=>String(x.id)===String(idv));if(!primary)return;const others=list.filter(x=>String(x.id)!==String(idv));if(!others.length){alert("There are no other active records to merge.");return;}$("adultMergeType").value=type;$("adultMergePrimary").value=idv;$("adultMergeTitle").textContent=type==="teacher"?"Merge Teacher Records":"Merge Volunteer Records";$("adultMergeOther").innerHTML='<option value="">Select duplicate…</option>'+others.map(x=>`<option value="${esc(x.id)}">${esc(type==='teacher'?teacherName(x):`${x.firstName} ${x.lastName}`)}</option>`).join('');$("adultMergeSurvivor").innerHTML=`<option value="${esc(idv)}">Keep ${esc(type==='teacher'?teacherName(primary):`${primary.firstName} ${primary.lastName}`)}</option>`;$("adultMergeFirst").value=primary.firstName||"";$("adultMergeLast").value=primary.lastName||"";$("adultMergeAllergies").value=primary.allergies||"";$("adultMergeTeacherFields").style.display=type==="teacher"?"block":"none";if(type==="teacher"){v14GroupOptions($("adultMergeGroup"),primary.group);$("adultMergeRole").value=primary.role||"Main Classroom Teacher";}$("v14AdultMergeModal").classList.remove("hidden")};
$("adultMergeOther")?.addEventListener("change",()=>{const type=$("adultMergeType").value,a=$("adultMergePrimary").value,b=$("adultMergeOther").value;if(!b)return;const list=type==="teacher"?v14TeacherRows():state.volunteers;const pa=list.find(x=>String(x.id)===String(a)),pb=list.find(x=>String(x.id)===String(b));$("adultMergeSurvivor").innerHTML=[pa,pb].map(x=>`<option value="${esc(x.id)}">Keep ${esc(type==='teacher'?teacherName(x):`${x.firstName} ${x.lastName}`)}</option>`).join('')});
$("adultMergeSubmit")?.addEventListener("click",async()=>{const type=$("adultMergeType").value,survivorId=$("adultMergeSurvivor").value,a=$("adultMergePrimary").value,b=$("adultMergeOther").value;if(!b||!survivorId)return;const duplicateId=survivorId===a?b:a;const person={firstName:$("adultMergeFirst").value.trim(),lastName:$("adultMergeLast").value.trim(),allergies:$("adultMergeAllergies").value.trim(),group:$("adultMergeGroup").value,role:$("adultMergeRole").value};if(!confirm("Merge these records? Attendance/serving history will be consolidated and the duplicate will be retired."))return;showLoading("Merging records…","Consolidating history and refreshing the Admin page");try{const token=sessionStorage.getItem(SESSION_KEYS.admin)||"";const r=await apiPost({action:type==="teacher"?"mergeTeacher":"mergeVolunteer",survivorId,duplicateId,person,token});if(!r.ok)throw new Error(r.error||"Merge failed.");v14Close("v14AdultMergeModal");await loadSharedState(token);v14Notice(type==="teacher"?"adminTeacherMessage":"volunteerMessage","Records merged. History was preserved.");}catch(e){v14Notice("adultMergeMessage",e.message)}finally{hideLoading();}});


window.v14AdminRemoveRoster=async sid=>{
  const p=studentProfile(sid);
  if(!p?.studentId)return;
  if(!confirm(`Remove ${p.studentName||"this student"} from the active classroom roster? Registration and all historical attendance will be preserved.`))return;
  showLoading("Removing from roster…","Preserving registration and attendance history");
  try{
    const token=sessionStorage.getItem(SESSION_KEYS.admin)||"";
    const data=await apiPost({action:"removeRosterStudent",studentId:sid,token});
    if(!data.ok)throw new Error(data.error||"Roster removal failed.");
    state.roster.forEach(x=>{if(String(x.studentId)===String(sid))x.activeRoster=false;});
    save();renderTeacher();renderAdmin();
    await loadSharedState(token);
    v14Notice("adminStudentMessage",`${p.studentName||"Student"} was removed from the classroom roster. Registration and history were preserved.`);
  }catch(e){v14Notice("adminStudentMessage","Student was not removed from the roster: "+(e.message||e));}
  finally{hideLoading();}
};
window.v14AdminUndoCheckin=async(studentId,date,name)=>{
  if(!sessionStorage.getItem(SESSION_KEYS.admin))return v14Notice("adminStudentMessage","Administrator sign-in required.");
  if(!confirm(`Undo the parent check-in for ${name} on ${fmt(date)}? Registration and classroom attendance will be preserved.`))return;
  showLoading("Undoing check-in…","Preserving registration and classroom attendance");
  try{
    await sync({action:"adminUndoParentCheckin",studentId,date});
    await v14Refresh();
    v14Notice("adminStudentMessage",`${name}'s check-in was undone. Registration and classroom attendance were preserved.`);
  }catch(e){v14Notice("adminStudentMessage","Check-in was not undone: "+(e.message||e));}
  finally{hideLoading();}
};
function v14AdminProfiles(){
  const d=selectedDate(),ids=new Set();state.students.forEach(s=>s.studentId&&ids.add(s.studentId));state.roster.forEach(r=>r.studentId&&ids.add(r.studentId));state.records.forEach(r=>r.studentId&&ids.add(r.studentId));
  const parentRegistered=new Set(state.students.filter(s=>s.studentId).map(s=>String(s.studentId)));
  return [...ids].map(studentId=>{const p=studentProfile(studentId),r=studentRecord(d,studentId);return {...p,studentId,registrationSource:parentRegistered.has(String(studentId))?"Parent registered":"Teacher/roster",checkedIn:!!r?.checkedInAt,present:studentStatus(d,studentId)==="Present"}}).filter(p=>p.activeRoster!==false);
}
function renderAdmin(){
  const d=selectedDate();let rows=v14AdminProfiles();const q=($("studentSearch")?.value||"").trim().toLowerCase(),cf=$("adminClassFilter")?.value||"",sf=$("adminStatusFilter")?.value||"";if(q)rows=rows.filter(r=>[r.studentName,r.parentName,r.firstName,r.lastName].some(x=>String(x||"").toLowerCase().includes(q)));if(cf)rows=rows.filter(r=>r.group===cf);if(sf==="checked")rows=rows.filter(r=>r.checkedIn);if(sf==="notchecked")rows=rows.filter(r=>!r.checkedIn);if(sf==="present")rows=rows.filter(r=>r.present);if(sf==="absent")rows=rows.filter(r=>!r.present);if(sf==="allergy")rows=rows.filter(r=>String(r.allergies||"").trim());if(sf==="permission")rows=rows.filter(r=>!r.photoPermission||!r.emergencyPermission);const mode=$("adminSort")?.value||"class-last",last=r=>(r.lastName||(r.studentName||"").split(/\s+/).pop()||"").toLowerCase(),first=r=>(r.firstName||(r.studentName||"").split(/\s+/)[0]||"").toLowerCase();rows.sort((a,b)=>mode==="last-class"?last(a).localeCompare(last(b))||v14CompareText(a.group,b.group):mode==="first"?first(a).localeCompare(first(b)):mode==="checked"?(+b.checkedIn-+a.checkedIn)||last(a).localeCompare(last(b)):mode==="present"?(+b.present-+a.present)||last(a).localeCompare(last(b)):mode==="allergy"?(!!b.allergies-!!a.allergies)||last(a).localeCompare(last(b)):v14CompareText(a.group,b.group)||last(a).localeCompare(last(b)));
  $("adminDateTitle").textContent=fmt(d);const all=v14AdminProfiles();$("checkedInCount").textContent=all.filter(r=>r.checkedIn).length;$("presentCount").textContent=all.filter(r=>r.present).length;const checked=all.filter(r=>r.checkedIn).length,presentChecked=all.filter(r=>r.checkedIn&&r.present).length;$("attendanceRate").textContent=checked?Math.round(presentChecked/checked*100)+"%":"0%";
  $("adminTable").innerHTML=rows.length?`<div style="overflow-x:auto"><table class="admin-student-table"><thead><tr><th class="sticky-name-col">Student</th><th class="sticky-actions-col">Actions</th><th>Class</th><th>Registration</th><th>Parent/guardian</th><th>Phone</th><th>Email</th><th>Age</th><th>Grade</th><th>Allergies</th><th>Photo</th><th>Transport</th><th>Parent check-in</th><th>Class status</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="sticky-name-col"><strong>${esc(r.studentName)}</strong></td><td class="sticky-actions-col"><div class="record-actions"><button class="small" onclick="openEditStudent('${esc(r.studentId)}')">Edit</button><button class="small" onclick="openMergeStudent('${esc(r.studentId)}')">Merge</button>${r.checkedIn?`<button class="small" onclick="v14AdminUndoCheckin('${esc(r.studentId)}','${esc(d)}','${esc(r.studentName)}')">Undo Check-In</button>`:""}<button class="danger small" onclick="v14AdminRemoveRoster('${esc(r.studentId)}')">Remove from Roster</button></div></td><td>${esc(r.group)}</td><td>${esc(r.registrationSource)}</td><td>${esc(r.parentName)}</td><td>${esc(r.phone)}</td><td>${esc(r.email)}</td><td>${esc(r.age)}</td><td>${esc(r.grade)}</td><td>${esc(r.allergies)||"—"}</td><td>${r.photoPermission?"Yes":"No"}</td><td>${r.emergencyPermission?"Yes":"No"}</td><td>${r.checkedIn?"Checked In":"Not Checked In"}</td><td>${r.present?"Present":"Absent"}</td></tr>`).join("")}</tbody></table></div>`:"<p class='muted'>No students match the current filters.</p>";
  const wm=weeklyMetrics(d);$("weeklyStudentTotal").textContent=wm.studentTotal;$("weeklyTeacherTotal").textContent=wm.teacherTotal;if($("weeklyVolunteerTotal"))$("weeklyVolunteerTotal").textContent=wm.volunteerTotal;if($("weeklyAdultTotal"))$("weeklyAdultTotal").textContent=wm.adultTotal;$("weeklyTotal").textContent=wm.total;$("dailyNotes").value=state.notes[d]||"";v14RenderAdminTeachers();renderVolunteers();renderChart();v14UpdateFloatingSave();
}
function renderTeacher(){
  const d=$("teacherDate")?.value||dates()[0];ensureWeek(d);
  $("teacherGroupTitle").textContent=activeGroup;
  const teachers=state.teachers[activeGroup]||[];
  $("teacherNames").textContent=teachers.map(teacherName).join(", ")||"No teachers added yet";
  const roster=new Map();
  state.roster.filter(p=>p.group===activeGroup&&p.activeRoster!==false).forEach(p=>p.studentId&&roster.set(String(p.studentId),p));
  state.records.filter(r=>r.date===d&&r.group===activeGroup&&r.checkedInAt&&studentProfile(r.studentId).activeRoster!==false).forEach(p=>p.studentId&&roster.set(String(p.studentId),p));
  const rows=[...roster.values()].map(p=>studentProfile(p.studentId)).filter(p=>p.activeRoster!==false).sort((a,b)=>(a.studentName||"").localeCompare(b.studentName||""));
  $("teacherTable").innerHTML=rows.length?`<div style="overflow-x:auto"><table><thead><tr><th>Student</th><th>Grade</th><th>Parent Check-In</th><th>Class Attendance</th><th>Roster</th></tr></thead><tbody>${rows.map(p=>{
    const pr=v14EffectiveStudent(p.studentId,d)==="present",pending=v14PendingStudent[v14Key(d,p.studentId)]!==undefined,checked=!!studentRecord(d,p.studentId)?.checkedInAt,allergy=String(p.allergies||"").trim();
    return `<tr class="${pending?'pending-change':''}"><td><strong>${esc(p.studentName||"Unnamed student")}</strong>${allergy?`<span class="allergy-alert">Allergy: ${esc(allergy)}</span>`:"<span class='muted'>No allergy listed</span>"}</td><td>${esc(p.grade)}</td><td>${checked?"Checked In":"Not Checked In"}</td><td><button type="button" class="attendance-btn ${pr?'attendance-present':'attendance-absent'}" onclick="setStudentAttendance('${esc(p.studentId)}','${d}','${pr?'absent':'present'}')">${pr?'Present':'Absent'}</button>${pending?'<div class="muted">Pending save</div>':''}</td><td><div class="record-actions"><button type="button" class="small" onclick="v14EditRoster('${esc(p.studentId)}')">Edit</button></div></td></tr>`}).join("")}</tbody></table></div>`:"<p class='muted'>No students in this group yet.</p>";
  $("teacherList").innerHTML=teachers.map(t=>{
    const tid=t.id||t.teacherId,pr=v14EffectiveTeacher(tid,d)==="present",pending=v14PendingTeacher[v14Key(d,tid)]!==undefined,allergy=String(t.allergies||"").trim();
    return `<div class="teacher-person ${pending?'pending-change':''}"><div class="person-name"><strong>${esc(teacherName(t))}</strong><div class="role-label">${esc(t.role||"Main Classroom Teacher")}</div>${allergy?`<span class="allergy-alert">Allergy: ${esc(allergy)}</span>`:""}</div><button type="button" class="attendance-btn ${pr?'attendance-present':'attendance-absent'}" onclick="setTeacherAttendance('${esc(tid)}','${d}','${pr?'absent':'present'}')">${pr?'Present':'Absent'}</button><div class="record-actions"><button type="button" class="small" onclick="v14EditTeacher('${esc(tid)}')">Edit</button><button type="button" class="small" onclick="v14RemoveTeacher('${esc(tid)}')">Remove</button></div></div>`}).join("")||"<p class='muted'>No teachers added yet.</p>";
  v14UpdateFloatingSave();
}

function v14FilteredStudentRows(){
  let rows=v14AdminProfiles();const q=($("studentSearch")?.value||"").trim().toLowerCase(),cf=$("adminClassFilter")?.value||"",sf=$("adminStatusFilter")?.value||"";
  if(q)rows=rows.filter(r=>[r.studentName,r.parentName,r.firstName,r.lastName].some(x=>textValue(x).toLowerCase().includes(q)));
  if(cf)rows=rows.filter(r=>r.group===cf);
  if(sf==="checked")rows=rows.filter(r=>r.checkedIn);if(sf==="notchecked")rows=rows.filter(r=>!r.checkedIn);if(sf==="present")rows=rows.filter(r=>r.present);if(sf==="absent")rows=rows.filter(r=>!r.present);if(sf==="allergy")rows=rows.filter(r=>textValue(r.allergies).trim());if(sf==="permission")rows=rows.filter(r=>!r.photoPermission||!r.emergencyPermission);
  return rows;
}
function v14FilteredTeachers(){let rows=v14TeacherRows();const q=($("teacherSearch")?.value||"").trim().toLowerCase(),sf=$("adminStatusFilter")?.value||"";if(q)rows=rows.filter(t=>[teacherName(t),t.group,t.role].some(x=>textValue(x).toLowerCase().includes(q)));if(sf==="allergy")rows=rows.filter(t=>textValue(t.allergies).trim());return rows;}
function v14FilteredVolunteers(){let rows=[...(state.volunteers||[])];const q=($("volunteerSearch")?.value||"").trim().toLowerCase(),sf=$("adminStatusFilter")?.value||"";if(q)rows=rows.filter(v=>`${textValue(v.firstName)} ${textValue(v.lastName)}`.toLowerCase().includes(q));if(sf==="allergy")rows=rows.filter(v=>textValue(v.allergies).trim());return rows;}
function v14AdminExportHtml(){
  const d=selectedDate(),students=v14FilteredStudentRows().sort((a,b)=>v14CompareText(a.group,b.group)||v14CompareText(a.lastName,b.lastName));
  const teachers=v14FilteredTeachers().sort((a,b)=>v14CompareText(a.lastName,b.lastName)||v14CompareText(a.firstName,b.firstName));
  const volunteers=v14FilteredVolunteers().sort((a,b)=>v14CompareText(a.lastName,b.lastName)||v14CompareText(a.firstName,b.firstName));
  const sf=$("adminStatusFilter")?.value||"";const filterNote=sf==="allergy"?"Allergy filter applied to students, teachers, and volunteers.":"Current Admin filters/searches applied.";
  return `<html><head><meta charset="utf-8"><title>Ira Baptist Admin Report</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#171717}h1{border-bottom:4px solid #ff6a00;padding-bottom:8px}h2{margin-top:24px;border-bottom:1px solid #bbb}.person{break-inside:avoid;border-bottom:1px solid #ddd;padding:8px 0}.label{font-weight:bold}.allergy{font-weight:bold;color:#9a3412}</style></head><body><h1>Ira Baptist Admin Report</h1><p><b>Week:</b> ${esc(fmt(d))}<br>${esc(filterNote)}</p><h2>Students (${students.length})</h2>${students.length?students.map(r=>`<div class="person"><strong>${esc(r.studentName)}</strong> — ${esc(r.group)} · ${esc(r.grade)} · ${esc(r.age)}<br><span class="label">Registration:</span> ${esc(r.registrationSource)} &nbsp; <span class="label">Parent:</span> ${esc(r.parentName)}<br><span class="label">Phone:</span> ${esc(r.phone)} &nbsp; <span class="label">Email:</span> ${esc(r.email)}<br><span class="allergy">Allergies: ${esc(r.allergies)||"None listed"}</span><br><span class="label">Photo:</span> ${r.photoPermission?"Yes":"No"} &nbsp; <span class="label">Transport:</span> ${r.emergencyPermission?"Yes":"No"} &nbsp; <span class="label">Check-in:</span> ${r.checkedIn?"Yes":"No"} &nbsp; <span class="label">Present:</span> ${r.present?"Yes":"No"}</div>`).join(""):"<p>None match the current filter.</p>"}<h2>Teachers (${teachers.length})</h2>${teachers.length?teachers.map(t=>`<div class="person"><strong>${esc(teacherName(t))}</strong> — ${esc(t.group)} · ${esc(t.role||"")}<br><span class="allergy">Allergies: ${esc(t.allergies)||"None listed"}</span></div>`).join(""):"<p>None match the current filter.</p>"}<h2>Volunteers (${volunteers.length})</h2>${volunteers.length?volunteers.map(v=>{const x=(state.volunteerSchedule[d]||{})[v.id]||{};return `<div class="person"><strong>${esc(textValue(v.firstName))} ${esc(textValue(v.lastName))}</strong><br><span class="allergy">Allergies: ${esc(v.allergies)||"None listed"}</span><br><span class="label">Present:</span> ${x.present?"Yes":"No"} &nbsp; <span class="label">Serving:</span> ${x.serving?"Yes":"No"}${x.area?` — ${esc(x.area)}`:""}</div>`}).join(""):"<p>None match the current filter.</p>"}</body></html>`;
}
$("printStudentInfo")?.addEventListener("click",()=>{const w=window.open("","_blank");w.document.write(v14AdminExportHtml());w.document.close();w.focus();setTimeout(()=>w.print(),200)});
$("downloadStudentDoc")?.addEventListener("click",()=>{const blob=new Blob([v14AdminExportHtml()],{type:"application/msword"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Ira_Baptist_Admin_Report_${selectedDate()}.doc`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});

async function v14LoadKitchen(){
  try{showLoading("Loading Kitchen Page…","Getting current allergy and serving information");const data=await apiPost({action:"publicKitchen"});if(!data.ok)throw new Error(data.error||"Kitchen data could not load.");v14KitchenState=data.state;v14PopulateKitchenDates();v14RenderKitchen();}catch(e){v14Notice("kitchenMessage",e.message||"Kitchen data could not load.")}finally{hideLoading()}
}
function v14PopulateKitchenDates(){if(!v14KitchenState)return;const deleted=v14KitchenState.deletedWeeks||[],custom=v14KitchenState.customWeeks||[],out=[];let d=new Date(CONFIG.startDate+"T00:00:00");for(let i=0;i<53;i++){const x=d.toISOString().slice(0,10);if(!deleted.includes(x))out.push(x);d.setDate(d.getDate()+7)}custom.forEach(x=>{if(x&&!deleted.includes(x)&&!out.includes(x))out.push(x)});out.sort();const el=$("kitchenDate"),old=el.value||v14PageState.kitchenWeek;el.innerHTML=out.map(x=>`<option value="${x}">${fmt(x)}</option>`).join("");el.value=out.includes(old)?old:(out.find(x=>new Date(x+"T00:00:00")>=new Date(new Date().toDateString()))||out[out.length-1]||"")}
function v14KitchenPerson(x){return { ...x, firstName:textValue(x?.firstName), lastName:textValue(x?.lastName), group:textValue(x?.group), role:textValue(x?.role), grade:textValue(x?.grade), age:textValue(x?.age), parentName:textValue(x?.parentName), studentName:textValue(x?.studentName)||[textValue(x?.firstName),textValue(x?.lastName)].filter(Boolean).join(" "), allergies:textValue(x?.allergies??x?.foodAllergies) };}
function v14AllergyEntries(value){
  const absent=new Set(["","none","none known","none reported","none listed","no","no allergies","no food allergies","no known allergies","no known food allergies","nka","n/a","na","nil","not applicable"]);
  return [...new Map(textValue(value).split(/[,;\n]+/).map(s=>s.trim()).filter(s=>!absent.has(s.toLowerCase())).map(s=>[s.toLowerCase(),s])).values()];
}
function v14AllergyGroups(people){
  const groups=new Map();
  people.forEach(p=>v14AllergyEntries(p.allergies).forEach(allergy=>{
    const key=allergy.toLowerCase();
    if(!groups.has(key))groups.set(key,{allergy,people:new Map()});
    groups.get(key).people.set(String(p.personId),p);
  }));
  return [...groups.values()].sort((a,b)=>v14CompareText(a.allergy,b.allergy));
}
function v14AllergyGroupHtml(groups,emptyText){
  return groups.length?groups.map(g=>`<div class="kitchen-allergy-group"><h4 class="kitchen-allergy-name">${esc(g.allergy)}</h4><ul>${[...g.people.values()].sort((a,b)=>v14CompareText(a.name,b.name)).map(p=>`<li><strong>${esc(p.name)}</strong>${p.detail?` <span class="muted">— ${esc(p.detail)}</span>`:""}</li>`).join("")}</ul></div>`).join(""):`<p class="muted">${esc(emptyText)}</p>`;
}
function v14KitchenAverage(history,selectedDate,today,limit=4){
  const rows=(Array.isArray(history)?history:[]).filter(r=>{
    const d=String(r.date||"");
    return /^\d{4}-\d{2}-\d{2}$/.test(d)&&d<today&&d<=selectedDate&&
      ["kids","adults","total"].every(k=>Number.isFinite(Number(r[k]))&&Number(r[k])>=0);
  }).sort((a,b)=>a.date.localeCompare(b.date)).slice(-limit);
  if(!rows.length)return null;
  const sum=k=>rows.reduce((n,r)=>n+Number(r[k]),0);
  return {weeks:rows.length,first:rows[0].date,last:rows[rows.length-1].date,
    kids:sum("kids")/rows.length,adults:sum("adults")/rows.length,total:sum("total")/rows.length};
}
function v14RenderKitchenAverages(){
  if(!v14KitchenState)return;
  const date=$("kitchenDate").value,today=v14KitchenState.today||new Date().toISOString().slice(0,10);
  const avg=v14KitchenAverage(v14KitchenState.historicalCounts,date,today);
  for(const [id,key] of [["kitchenAverageKids","kids"],["kitchenAverageAdults","adults"],["kitchenAverageTotal","total"]]){
    $(id).textContent=avg?avg[key].toFixed(1):"—";
  }
  $("kitchenAveragePeriod").textContent=avg
    ?`Last ${avg.weeks} recorded completed service week${avg.weeks===1?"":"s"}: ${fmt(avg.first)} – ${fmt(avg.last)}. Each week is counted once; missing weeks are not treated as zero.`
    :"No completed service weeks with recorded attendance are available for this date.";
}
function v14RenderKitchen(){
  if(!v14KitchenState)return;
  v14RenderKitchenAverages();
  const d=$("kitchenDate").value;
  const students=(v14KitchenState.students||[]).map(v14KitchenPerson),records=v14KitchenState.records||[],teachers=(v14KitchenState.teachers||[]).map(v14KitchenPerson),volunteers=(v14KitchenState.volunteers||[]).map(v14KitchenPerson),sch=(v14KitchenState.volunteerSchedule||{})[d]||{};
  const checked=new Set(records.filter(r=>r.date===d&&r.checkedIn).map(r=>String(r.studentId)));
  $("kitchenCheckedIn").textContent=checked.size;$("kitchenRegistered").textContent=students.length;
  const adults=[...teachers.map(t=>({...t,kind:`Teacher — ${t.group} · ${t.role}`})),...volunteers.map(v=>({...v,kind:"Volunteer"}))];
  const uniqueAdults=new Set(adults.map(a=>v14PersonKey(a.firstName,a.lastName,a.id)));$("kitchenAdults").textContent=uniqueAdults.size;
  const studentPeople=students.map(s=>({
    personId:s.studentId,name:s.studentName||"Unnamed student",allergies:s.allergies,
    detail:[s.group,s.grade,s.age,s.parentName?`Parent: ${s.parentName}`:"",checked.has(String(s.studentId))?"Checked in this week":""].filter(Boolean).join(" · ")
  }));
  const adultPeople=new Map();
  adults.forEach(a=>{
    const key=v14PersonKey(a.firstName,a.lastName,a.id);
    const prior=adultPeople.get(key)||{personId:key,name:[a.firstName,a.lastName].filter(Boolean).join(" ")||"Unnamed adult",allergies:"",roles:new Set()};
    prior.roles.add(a.kind);
    prior.allergies=[...new Set([...v14AllergyEntries(prior.allergies),...v14AllergyEntries(a.allergies)])].join("; ");
    adultPeople.set(key,prior);
  });
  $("kitchenStudents").innerHTML=v14AllergyGroupHtml(v14AllergyGroups(studentPeople),"No documented student food allergies.");
  $("kitchenAdultsList").innerHTML=v14AllergyGroupHtml(v14AllergyGroups([...adultPeople.values()].map(a=>({...a,detail:[...a.roles].join(" · ")}))),"No documented adult food allergies.");
  // All volunteers remain available for assignments, even when they have no allergy.
  $("kitchenVolunteers").innerHTML=volunteers.slice().sort((a,b)=>v14CompareText(a.lastName,b.lastName)||v14CompareText(a.firstName,b.firstName)).map(v=>{const x=sch[v.id]||{},isKitchen=x.serving&&x.area==="Kitchen";return `<div class="adult-row"><div><strong>${esc(v.firstName)} ${esc(v.lastName)}</strong>${v14AllergyEntries(v.allergies).length?`<span class="allergy-alert">Allergy: ${esc(v.allergies)}</span>`:""}</div><button class="attendance-btn ${x.present?'attendance-present':'attendance-absent'}" onclick="v14KitchenTogglePresent('${esc(v.id)}')">${x.present?'Present':'Absent'}</button><button class="small ${isKitchen?'primary':''}" onclick="v14KitchenToggleServing('${esc(v.id)}')">${isKitchen?'Serving Kitchen':'Not Serving Kitchen'}</button><span></span></div>`}).join('')||"<p class='muted'>No active volunteers.</p>";
}

window.v14KitchenTogglePresent=async idv=>{const d=$("kitchenDate").value,sch=v14KitchenState.volunteerSchedule[d]??={},x=sch[idv]||{present:false,serving:false,area:"",other:""};x.present=!x.present;sch[idv]=x;v14KitchenState.volunteerSchedule[d]=sch;v14RenderKitchen();try{const r=await apiPost({action:"kitchenSaveVolunteerSchedule",date:d,volunteerId:idv,present:x.present,serving:x.serving&&x.area==="Kitchen"});if(!r.ok)throw new Error(r.error)}catch(e){x.present=!x.present;v14RenderKitchen();v14Notice("kitchenMessage","Change did not save: "+e.message)}};
window.v14KitchenToggleServing=async idv=>{const d=$("kitchenDate").value,sch=v14KitchenState.volunteerSchedule[d]??={},x=sch[idv]||{present:false,serving:false,area:"",other:""},was=x.serving&&x.area==="Kitchen";x.serving=!was;x.area=x.serving?"Kitchen":"";x.other="";sch[idv]=x;v14KitchenState.volunteerSchedule[d]=sch;v14RenderKitchen();try{const r=await apiPost({action:"kitchenSaveVolunteerSchedule",date:d,volunteerId:idv,present:x.present,serving:x.serving});if(!r.ok)throw new Error(r.error)}catch(e){x.serving=was;x.area=was?"Kitchen":"";v14RenderKitchen();v14Notice("kitchenMessage","Change did not save: "+e.message)}};
$("kitchenDate")?.addEventListener("change",()=>{v14RenderKitchen();v14RememberLocation();});$("printKitchen")?.addEventListener("click",()=>{document.querySelectorAll('.view').forEach(v=>v.classList.remove('print-target'));$("kitchen").classList.add('print-target');window.print();$("kitchen").classList.remove('print-target')});document.querySelector('[data-view="kitchen"]')?.addEventListener("click",v14LoadKitchen);

function v14GuardPendingForWeek(){if(!v14HasPending())return true;return confirm("You have unsaved attendance/serving changes. Leave them pending and switch weeks anyway? Use the floating Save Changes button first if you want to save them.")}
$("addWeekButton")?.addEventListener("click",async()=>{
  const d=$("weekDateInput").value;
  if(!d)return v14Notice("weekMessage","Choose a date first.");
  if(!v14GuardPendingForWeek())return;
  let saved=false;
  showLoading("Adding service week…","Loading attendance for the selected date");
  try{
    await sync({action:"addWeek",date:d});saved=true;
    const token=sessionStorage.getItem(SESSION_KEYS.admin);
    await loadSharedState(token);
    setServiceWeek(d);v14LastServiceDate=d;
    renderTeacher();renderAdmin();v14RememberLocation();
    v14Notice("weekMessage",`${fmt(d)} was added. Attendance is separate from every other week.`);
  }catch(e){v14Notice("weekMessage",saved?"The week was saved, but the latest attendance could not load. Please refresh.":e.message);}
  finally{hideLoading();}
});
$("editWeekButton")?.addEventListener("click",async()=>{
  const oldDate=selectedDate(),newDate=$("weekDateInput").value;
  if(!newDate)return v14Notice("weekMessage","Choose the new date first.");
  if(oldDate===newDate)return v14Notice("weekMessage","The selected week already uses that date.");
  if(!v14GuardPendingForWeek())return;
  if(!confirm(`Change ${fmt(oldDate)} to ${fmt(newDate)}? Linked student, teacher, volunteer attendance and daily notes will move to the new date.`))return;
  let saved=false;
  showLoading("Changing service week…","Preserving linked attendance and notes");
  try{
    await sync({action:"editWeek",oldDate,newDate});saved=true;
    const token=sessionStorage.getItem(SESSION_KEYS.admin);
    await loadSharedState(token);
    setServiceWeek(newDate);v14LastServiceDate=newDate;
    renderTeacher();renderAdmin();v14RememberLocation();
    v14Notice("weekMessage","Week changed and linked history moved to the new date.");
  }catch(e){v14Notice("weekMessage",saved?"The date change was saved, but the latest records could not load. Please refresh.":e.message);}
  finally{hideLoading();}
});

["studentSearch","adminClassFilter","adminStatusFilter","adminSort"].forEach(idn=>$(idn)?.addEventListener(idn==="studentSearch"?"input":"change",renderAdmin));["teacherSearch","teacherSort"].forEach(idn=>$(idn)?.addEventListener(idn==="teacherSearch"?"input":"change",v14RenderAdminTeachers));["volunteerSearch","volunteerSort"].forEach(idn=>$(idn)?.addEventListener(idn==="volunteerSearch"?"input":"change",renderVolunteers));


initApp().then(()=>v14RestoreLocation()).catch(e=>{
  console.error("Unable to restore the previous page",e);
  v14LocationReady=true;v14RememberLocation();
});
