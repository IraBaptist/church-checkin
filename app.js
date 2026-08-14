const CONFIG={
  startDate:"2026-08-19",
  googleAppsScriptUrl:"https://script.google.com/macros/s/AKfycbzqHTVI0KGx4Re_n6J3AgELQTRY4bDpj-YbCNIq59QYQZe9cB5tBzh3C9r0YtfqQ5O6/exec"
};

const SESSION_KEYS={teacher:"iraBaptistTeacherSession",admin:"iraBaptistAdminSession"};
const ADMIN_ACTIONS=new Set(["addVolunteer","saveVolunteerSchedule","volunteerAttendance","saveNotes","addWeek","deleteWeek","editWeek","updateStudent","deleteStudent"]);
const TEACHER_ACTIONS=new Set(["markPresent","unmarkPresent","setStudentAttendance","addTeacher","saveTeacherAttendance","setTeacherAttendance","addRosterStudent"]);
let returningLookup=new Map();

const KEY="iraBaptistCheckinV13";
let state=load(),activeGroup="PreK-K",attendanceChart=null;
let sharedLoadedAt=0;
const SHARED_REFRESH_MS=30000;
const $=id=>document.getElementById(id);

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
  if(sourceId!=="parentDate"&&$("parentDate")) refreshReturningResults();
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
async function sync(payload){
  if(!CONFIG.googleAppsScriptUrl){
    $("connectionStatus").textContent="Local testing mode";
    return {ok:true};
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
  return {
    studentId:textValue(s.studentId),
    studentName:textValue(s.studentName)||`${studentFirst} ${studentLast}`.trim(),
    firstName:studentFirst,
    lastName:studentLast,
    parentName:textValue(s.parentName)||`${parentFirst} ${parentLast}`.trim(),
    parentFirst,
    parentLast,
    email:textValue(s.email),phone:textValue(s.phone),age:textValue(s.age),grade:textValue(s.grade),group:textValue(s.group),
    allergies:textValue(s.allergies??s.foodAllergies),
    photoPermission:s.photoPermission??s.photoConsent??false,
    emergencyPermission:s.emergencyPermission??s.transportConsent??false
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
    state.teachers[group].push({id:t.id||t.teacherId||id(),firstName:t.firstName||"",lastName:t.lastName||"",group});
  });
  if(remote.volunteers)state.volunteers=remote.volunteers.map(v=>({id:v.id||v.volunteerId||id(),firstName:v.firstName||"",lastName:v.lastName||"",name:`${v.firstName||""} ${v.lastName||""}`.trim()}));
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
  let token=sessionStorage.getItem(key)||"";
  if(view==="teacher"&&!token)token=sessionStorage.getItem(SESSION_KEYS.admin)||"";
  if(token){
    // Page switching should be immediate after a successful login.
    // Reuse the shared state we already loaded instead of waiting on Apps Script every click.
    if(sharedStateIsFresh()) return true;
    try{await loadSharedState(token);return true}catch(e){sessionStorage.removeItem(key)}
  }
  const label=view==="admin"?"Admin":"Teacher";
  const password=prompt(`${label} password:`);
  if(password===null)return false;
  try{
    const login=await apiPost({action:"login",password});
    if(!login.ok)throw new Error(login.error||"Incorrect password.");
    if(view==="admin"&&login.role!=="admin")throw new Error("That is not the Admin password.");
    sessionStorage.setItem(SESSION_KEYS[login.role],login.token);
    await loadSharedState(login.token);
    return true;
  }catch(e){
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
  setServiceWeek(fallback);
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
      group:t.group||fallbackGroup
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
    studentName:saved.studentName||historical.studentName||roster.studentName||"",
    firstName:saved.firstName||historical.firstName||"",
    lastName:saved.lastName||historical.lastName||"",
    parentName:saved.parentName||historical.parentName||"",
    parentFirst:saved.parentFirst||historical.parentFirst||"",
    parentLast:saved.parentLast||historical.parentLast||"",
    phone:saved.phone||historical.phone||"",
    email:saved.email||historical.email||"",
    age:saved.age||historical.age||"",
    grade:saved.grade||historical.grade||roster.grade||"",
    group:saved.group||historical.group||roster.group||"",
    allergies:saved.allergies??historical.allergies??"",
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

  const roster=state.roster.filter(r=>r.group===activeGroup);
  const students=state.students.filter(s=>s.group===activeGroup);
  const checked=state.records.filter(r=>r.date===d&&r.group===activeGroup);

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
  state.weeklyStudentAttendance[date][studentId]=status==="present"?"present":"absent";
  state.studentAttendance??={};
  state.studentAttendance[date]??={};
  state.studentAttendance[date][studentId]=status==="present"?"Present":"Absent";
  save();
  renderTeacher();
  renderAdmin();
  await sync({action:"setStudentAttendance",studentId,date,status:state.weeklyStudentAttendance[date][studentId]});
};
window.setTeacherAttendance=async(teacherId,date,status)=>{
  ensureWeek(date);
  state.weeklyTeacherAttendance[date][teacherId]=status==="present"?"present":"absent";
  state.teacherAttendance??={};
  state.teacherAttendance[date]??={};
  state.teacherAttendance[date][teacherId]=status==="present"?"Present":"Absent";
  state.staffAttendance??={};
  state.staffAttendance[date]??={};
  state.staffAttendance[date][teacherId]={status:status==="present"?"present":"absent",present:status==="present"};
  save();
  renderTeacher();
  renderAdmin();
  await sync({action:"setTeacherAttendance",teacherId,date,status:state.weeklyTeacherAttendance[date][teacherId]});
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


function weekStart(date){
  const start=new Date(CONFIG.startDate+"T00:00:00");
  const d=new Date(date+"T00:00:00");
  const n=Math.max(0,Math.floor((d-start)/604800000));
  start.setDate(start.getDate()+n*7);
  return start.toISOString().slice(0,10);
}
function weeklyMetrics(date){
  const start=weekStart(date);
  const end=new Date(start+"T00:00:00");
  end.setDate(end.getDate()+6);
  const e=end.toISOString().slice(0,10);

  let students=0; Object.entries(state.studentAttendance||{}).forEach(([day,items])=>{if(day>=start&&day<=e) Object.values(items||{}).forEach(v=>{if(v==="Present")students++})});
  let teachers=0;
  let volunteers=0;

  dates().filter(x=>x>=start&&x<=e).forEach(day=>{
    Object.values(state.staffAttendance[day]||{}).forEach(x=>{
      if(x?.status==="present")teachers++;
    });
    Object.values(state.volunteerSchedule[day]||{}).forEach(x=>{
      if(x?.present)volunteers++;
    });
  });

  return {studentTotal:students,teacherTotal:teachers,volunteerTotal:volunteers,total:students+teachers+volunteers};
}

function renderChart(){
  const c=$("attendanceChart");
  if(!c||typeof Chart==="undefined")return;

  const labels=[],s=[],t=[],tot=[];
  dates().forEach(d=>{
    const m=weeklyMetrics(d);
    labels.push(new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}));
    s.push(m.studentTotal);
    t.push(m.teacherTotal);
    tot.push(m.total);
  });

  if(attendanceChart)attendanceChart.destroy();
  attendanceChart=new Chart(c,{
    type:"line",
    data:{labels,datasets:[
      {label:"Students",data:s,tension:.25},
      {label:"Teachers",data:t,tension:.25},
      {label:"Total",data:tot,tension:.25}
    ]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}
  });
}

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
      checkedIn:!!weekRecord,
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
            <td><div class="record-actions"><button type="button" class="small" onclick="openEditStudent('${r.studentId}')">Edit</button><button type="button" class="danger small" onclick="deleteStudentRecord('${r.studentId}')">Delete</button></div></td>
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
      const x=sch[v.id]||{serving:false,area:"",other:"",present:false};
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
    $("parentMessage").textContent=
      phoneDigits.length!==10
      ? "Please enter a complete 10-digit phone number."
      : !email
      ? "Email is required."
      : !grade
      ? "Grade is required."
      : !age
      ? "Age is required."
      : "Please complete all required fields.";
    $("parentMessage").classList.remove("hidden");
    return;
  }

  const studentName=`${first} ${last}`;
  const parentName=`${parentFirst} ${parentLast}`;
  const d=serviceDate();

  // A student is added to Returning Student only here, after a successful new-student check-in.
  const studentId=id();
  const rec={
    id:id(),studentId,studentName,parentName,parentFirst,parentLast,email,phone,age,grade,
    allergies,photoPermission,emergencyPermission,group:teacherGroup(grade),date:d,checkedInBy:"Parent/Guardian",
    checkedInAt:new Date().toISOString(),present:false
  };

  state.records.push(rec);
  state.students.push({
    studentId,studentName,firstName:first,lastName:last,parentName,parentFirst,parentLast,
    email,phone,age,grade,allergies,photoPermission,emergencyPermission,
    group:rec.group
  });
  state.roster.push({studentId,studentName,grade,group:rec.group});
  save();

  $("parentMessage").textContent=`${studentName} checked in.`;
  $("parentMessage").classList.remove("hidden");
  e.target.reset();
  formatPhone($("phone"));

  try{
    const result=await sync({action:"checkin",record:rec});
    sharedLoadedAt=0;
    if(result && result.studentSaved===false){
      throw new Error("The weekly check-in saved, but the permanent student profile did not save.");
    }
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
  let found=[];
  if(CONFIG.googleAppsScriptUrl){
    try{
      const data=await apiPost({action:"parentLookup",lastName:q,date:d});
      if(data.ok)found=data.students||[];
    }catch(e){console.warn("Returning Student lookup failed",e)}
  }else{
    const lower=q.toLowerCase();
    found=state.students.filter(s=>(s.lastName||s.studentName.split(/\s+/).pop()||"").toLowerCase()===lower).map(s=>({...s,checkedIn:!!state.records.find(r=>r.studentId===s.studentId&&r.date===d)}));
  }
  returningLookup=new Map(found.map(s=>[String(s.studentId),s]));
  $("familyResults").innerHTML=found.length?found.map(s=>`<div class="card">
      <strong>${esc(s.studentName)}</strong>
      <div class="muted">${esc(s.grade)} · ${esc(s.age)}</div>
      ${s.checkedIn
        ? `<button type="button" disabled>Checked In</button>`
        : `<button class="primary" type="button" onclick="returnCheckin('${esc(s.studentId)}')">Check In</button>`}
    </div>`).join(""):"<p class='muted'>No students found.</p>";
}
$("lookupFamily").addEventListener("click",refreshReturningResults);

window.returnCheckin=async sid=>{
  const d=serviceDate();
  const info=returningLookup.get(String(sid));
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
  if(!confirm(`Delete ${name}'s student record? This will permanently remove the saved student profile and all of this student's check-in and attendance history.`))return;

  state.students=state.students.filter(s=>s.studentId!==studentId);
  state.roster=state.roster.filter(r=>r.studentId!==studentId);
  state.records=state.records.filter(r=>r.studentId!==studentId);

  Object.values(state.studentAttendance||{}).forEach(day=>{if(day)delete day[studentId]});
  Object.values(state.weeklyStudentAttendance||{}).forEach(day=>{if(day)delete day[studentId]});

  save();
  await sync({action:"deleteStudent",studentId});
  refreshReturningResults();
  renderTeacher();
  renderAdmin();
};

$("adminSort")?.addEventListener("change",renderAdmin);
$("parentDate")?.addEventListener("change",()=>{setServiceWeek($("parentDate").value,"parentDate");refreshReturningResults();renderTeacher();renderAdmin();});
$("teacherDate").addEventListener("change",()=>{setServiceWeek($("teacherDate").value,"teacherDate");renderTeacher();renderAdmin();});
$("adminDate").addEventListener("change",()=>{setServiceWeek($("adminDate").value,"adminDate");renderTeacher();renderAdmin();});

document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",async()=>{
  const view=b.dataset.view;
  if(!(await ensureAccess(view)))return;
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  $(view).classList.add("active");
  if(view==="teacher")renderTeacher();
  if(view==="admin")renderAdmin();
}));

document.querySelectorAll(".teacher-tab").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".teacher-tab").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  activeGroup=b.dataset.group;
  renderTeacher();
}));

$("teacherForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const firstName=$("teacherFirstName").value.trim();
  const lastName=$("teacherLastName").value.trim();
  const group=$("teacherClass").value;
  if(!firstName||!lastName||!group)return;
  state.teachers[group]??=[];
  const t={id:id(),firstName,lastName,group};
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
  const first=$("rosterFirstName").value.trim();
  const last=$("rosterLastName").value.trim();
  const grade=$("rosterGrade").value;
  if(!first||!last||!grade)return;

  const student={studentId:id(),studentName:`${first} ${last}`,firstName:first,lastName:last,grade,group:teacherGroup(grade)};
  state.roster.push(student);
  save();
  await sync({action:"addRosterStudent",student});
  $("rosterMessage").textContent=`${student.studentName} was added.`;
  $("rosterMessage").classList.remove("hidden");
  e.target.reset();
  renderTeacher();
});

$("volunteerForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const first=$("volunteerFirstName").value.trim();
  const last=$("volunteerLastName").value.trim();
  const name=`${first} ${last}`.trim();
  if(!first||!last)return;
  if(state.volunteers.some(v=>(v.name||"").toLowerCase()===name.toLowerCase()))return;

  const v={id:id(),firstName:first,lastName:last,name};
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
  $("notesMessage").textContent="Notes saved.";
  $("notesMessage").classList.remove("hidden");
});

$("deleteWeek").addEventListener("click",async()=>{
  const d=selectedDate();
  if(!confirm(`Remove ${fmt(d)} from the weekly calendar? This does not delete old attendance records.`))return;
  state.deletedWeeks.push(d);
  save();
  populateDates();
  renderTeacher();
  renderAdmin();
  await sync({action:"deleteWeek",date:d});
});

function initLogo(){
  const logo=$("logo");
  if(logo)logo.src="logo.png";
}

async function initApp(){
  initLogo();
  await loadPublicCalendar();
  populateDates();
  renderTeacher();
  renderAdmin();
  if($("connectionStatus"))$("connectionStatus").textContent="Google Sheets ready";
}
initApp();
