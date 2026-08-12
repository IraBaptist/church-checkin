const CONFIG={
  startDate:"2026-08-19",
  googleAppsScriptUrl:"",
  PASSWORD_PROTECTION_ENABLED:false,
  teacherPassword:"CHANGE-THIS-TEACHER-PASSWORD",
  adminPassword:"CHANGE-THIS-ADMIN-PASSWORD"
};
const KEY="iraBaptistCheckinV13";
let state=load(),activeGroup="PreK-K",attendanceChart=null;
const $=id=>document.getElementById(id);

function defaults(){return{records:[],students:[],teachers:{},roster:[],notes:{},volunteers:[],volunteerSchedule:{},staffAttendance:{},deletedWeeks:[]}}
function load(){try{return Object.assign(defaults(),JSON.parse(localStorage.getItem(KEY)||"{}"))}catch(e){return defaults()}}
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function esc(x){return String(x??"").replace(/[&<>\"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function id(){return crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random())}
function dates(){const out=[];let d=new Date(CONFIG.startDate+"T00:00:00");for(let i=0;i<53;i++){const s=d.toISOString().slice(0,10);if(!state.deletedWeeks.includes(s))out.push(s);d.setDate(d.getDate()+7)}return out}
function fmt(d){return new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"long",day:"numeric",year:"numeric"})}
function selectedDate(){return $("adminDate")?.value||dates()[0]}
function teacherGroup(g){if(g==="PreK"||g==="Kindergarten")return"PreK-K";if(g==="1st grade"||g==="2nd grade")return"1st-2nd";if(g==="3rd grade")return"3rd";if(g==="4th grade")return"4th";if(g==="5th grade")return"5th";if(g==="Adult")return"Adults";return ["6th grade","7th grade","8th grade","9th grade","10th grade","11th grade","12th grade"].includes(g)?"Youth":""}

function formatPhone(input){
  let v=input.value.replace(/\D/g,"").slice(0,10);
  if(v.length>6) v=`(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
  else if(v.length>3) v=`(${v.slice(0,3)}) ${v.slice(3)}`;
  else if(v.length) v=`(${v}`;
  input.value=v;
}
$("phone").addEventListener("input",()=>formatPhone($("phone")));

async function sync(payload){
  if(!CONFIG.googleAppsScriptUrl){$("connectionStatus").textContent="Local testing mode";return}
  try{await fetch(CONFIG.googleAppsScriptUrl,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});$("connectionStatus").textContent="Google Sheets connected"}
  catch(e){$("connectionStatus").textContent="Offline / demo mode"}
}

function populateDates(){
  ["teacherDate","adminDate"].forEach(idn=>{
    const el=$(idn);if(!el)return;const old=el.value;
    el.innerHTML=dates().map(d=>`<option value="${d}">${fmt(d)}</option>`).join("");
    if(dates().includes(old))el.value=old;
  });
}

function renderTeacher(){
  const d=$("teacherDate").value||dates()[0];
  $("teacherGroupTitle").textContent=activeGroup;
  $("teacherNames").textContent=(state.teachers[activeGroup]||[]).map(t=>typeof t==="string"?t:(t.name||`${t.firstName||""} ${t.lastName||""}`.trim())).join(", ")||"No teachers added yet";
  const roster=state.roster.filter(r=>r.group===activeGroup);
  const checked=state.records.filter(r=>r.date===d&&r.group===activeGroup);
  const rows=[...roster.map(r=>({studentId:r.studentId,studentName:r.studentName,grade:r.grade,present:false})),
              ...checked.map(r=>({studentId:r.studentId,studentName:r.studentName,grade:r.grade,present:!!r.present,recordId:r.id}))];
  const uniq=new Map(rows.map(r=>[r.studentId,r]));
  $("teacherTable").innerHTML=uniq.size?`<table><thead><tr><th>Student</th><th>Grade</th><th>Status</th></tr></thead><tbody>
  ${[...uniq.values()].map(r=>`<tr><td>${esc(r.studentName)}</td><td>${esc(r.grade)}</td><td>${r.present?"Present":r.recordId?`<button onclick="markPresent('${r.recordId}')">Mark Present</button>`:"Not checked in"}</td></tr>`).join("")}
  </tbody></table>`:"<p class='muted'>No students in this group yet.</p>";
  $("teacherList").innerHTML=(state.teachers[activeGroup]||[]).map((t,i)=>{
    const staffId=typeof t==="string"?t:(t.id||`${activeGroup}-${i}`);
    const n=typeof t==="string"?t:(t.name||`${t.firstName||""} ${t.lastName||""}`.trim());
    const status=((state.staffAttendance[d]||{})[staffId]||{}).status||"";
    return `<div class="staff-row">
      <span>${esc(n)}</span>
      <button type="button" class="${status==="present"?"primary":""}" onclick="setTeacherAttendance('${esc(staffId)}','present')">Present</button>
      <button type="button" class="${status==="absent"?"primary":""}" onclick="setTeacherAttendance('${esc(staffId)}','absent')">Absent</button>
    </div>`;
  }).join("");
}
window.markPresent=async rid=>{
  const r=state.records.find(x=>x.id===rid);
  if(r){r.present=true;r.presentAt=new Date().toISOString();save();renderTeacher();renderAdmin();await sync({action:"markPresent",id:rid})}
};

function weekStart(date){
  const start=new Date(CONFIG.startDate+"T00:00:00"),d=new Date(date+"T00:00:00");
  const n=Math.max(0,Math.floor((d-start)/604800000));start.setDate(start.getDate()+n*7);return start.toISOString().slice(0,10)
}
function weeklyMetrics(date){
  const start=weekStart(date),end=new Date(start+"T00:00:00");end.setDate(end.getDate()+6);
  const e=end.toISOString().slice(0,10),rows=state.records.filter(r=>r.date>=start&&r.date<=e&&r.present);
  const groups=new Set(rows.map(r=>r.group));let teachers=0;groups.forEach(g=>teachers+=(state.teachers[g]||[]).length);
  return{studentTotal:rows.length,teacherTotal:teachers,total:rows.length+teachers}
}
function renderChart(){
  const c=$("attendanceChart");if(!c||typeof Chart==="undefined")return;
  const labels=[],s=[],t=[],tot=[];dates().forEach(d=>{const m=weeklyMetrics(d);labels.push(new Date(d+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}));s.push(m.studentTotal);t.push(m.teacherTotal);tot.push(m.total)});
  if(attendanceChart)attendanceChart.destroy();
  attendanceChart=new Chart(c,{type:"line",data:{labels,datasets:[{label:"Students",data:s,tension:.25},{label:"Teachers",data:t,tension:.25},{label:"Total",data:tot,tension:.25}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}})
}
window.setTeacherAttendance=async(staffId,status)=>{
  const d=$("teacherDate").value||dates()[0];
  state.staffAttendance[d]??={};
  state.staffAttendance[d][staffId]={status,present:status==="present"};
  save();
  await sync({action:"teacherAttendance",date:d,teacherId:staffId,status,present:status==="present"});
  renderTeacher(); renderAdmin();
};
function renderAdmin(){
  const d=selectedDate(),rows=state.records.filter(r=>r.date===d);
  $("adminDateTitle").textContent=fmt(d);$("checkedInCount").textContent=rows.length;
  $("presentCount").textContent=rows.filter(r=>r.present).length;
  $("attendanceRate").textContent=rows.length?Math.round(rows.filter(r=>r.present).length/rows.length*100)+"%":"0%";
  $("adminTable").innerHTML=rows.length?`<table><thead><tr><th>Student</th><th>Grade</th><th>Group</th><th>Checked In</th><th>Present</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td>${esc(r.studentName)}</td><td>${esc(r.grade)}</td><td>${esc(r.group)}</td><td>Yes</td><td>${r.present?"Yes":"No"}</td></tr>`).join("")}</tbody></table>`:"<p class='muted'>No check-ins for this date.</p>";
  const wm=weeklyMetrics(d);$("weeklyStudentTotal").textContent=wm.studentTotal;$("weeklyTeacherTotal").textContent=wm.teacherTotal;$("weeklyTotal").textContent=wm.total;
  $("dailyNotes").value=state.notes[d]||"";renderVolunteers();renderChart()
}
function renderVolunteers(){
  const d=selectedDate(),sch=state.volunteerSchedule[d]||{};
  if(!state.volunteers.length){
    $("volunteerTable").innerHTML="<p class='muted'>No volunteers added yet.</p>";
    return;
  }
  const areas=["Kitchen","PreK-K","1st-2nd","3rd","4th","5th","Youth","Adult Class","Other"];
  $("volunteerTable").innerHTML=`<table><thead><tr>
    <th>Volunteer</th><th>Present</th><th>Serving</th><th>Where</th><th>Other location</th>
  </tr></thead><tbody>${
    state.volunteers.map(v=>{
      const x=sch[v.id]||{serving:false,area:"",other:"",present:false};
      return `<tr>
        <td>${esc(v.firstName||v.name||"")} ${esc(v.lastName||"")}</td>
        <td><button onclick="toggleVolunteerPresent('${v.id}')">${x.present?"Present":"Not present"}</button></td>
        <td><button onclick="toggleVolunteer('${v.id}')">${x.serving?"Serving":"Not serving"}</button></td>
        <td><select onchange="setVolunteerArea('${v.id}',this.value)" ${x.serving?"":"disabled"}>
          <option value="">Select</option>${areas.map(a=>`<option ${x.area===a?"selected":""}>${a}</option>`).join("")}
        </select></td>
        <td>${x.area==="Other"?`<input value="${esc(x.other)}" onchange="setVolunteerOther('${v.id}',this.value)" placeholder="Where are they serving?">`:"—"}</td>
      </tr>`;
    }).join("")
  }</tbody></table>`;
}
window.toggleVolunteerPresent=async idv=>{
  const d=selectedDate();
  state.volunteerSchedule[d]??={};
  const x=state.volunteerSchedule[d][idv]||{serving:false,area:"",other:"",present:false};
  x.present=!x.present;
  state.volunteerSchedule[d][idv]=x;
  save();
  await sync({action:"volunteerAttendance",date:d,volunteerId:idv,present:x.present});
  renderVolunteers(); renderAdmin();
};

async function saveVS(idv){save();await sync({action:"saveVolunteerSchedule",date:selectedDate(),volunteerId:idv,schedule:(state.volunteerSchedule[selectedDate()]||{})[idv]||{}});renderVolunteers()}
window.toggleVolunteer=async idv=>{const d=selectedDate();state.volunteerSchedule[d]??={};const x=state.volunteerSchedule[d][idv]||{serving:false,area:"",other:""};x.serving=!x.serving;if(!x.serving){x.area="";x.other=""}state.volunteerSchedule[d][idv]=x;await saveVS(idv)}
window.setVolunteerArea=async(idv,a)=>{const d=selectedDate();state.volunteerSchedule[d]??={};const x=state.volunteerSchedule[d][idv]||{};x.serving=true;x.area=a;if(a!=="Other")x.other="";state.volunteerSchedule[d][idv]=x;await saveVS(idv)}
window.setVolunteerOther=async(idv,o)=>{const d=selectedDate();state.volunteerSchedule[d]??={};const x=state.volunteerSchedule[d][idv]||{serving:true,area:"",other:""};x.serving=true;x.other=o;state.volunteerSchedule[d][idv]=x;save();await sync({action:"saveVolunteerSchedule",date:d,volunteerId:idv,schedule:state.volunteerSchedule[d][idv]});renderVolunteers()}

$("parentForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const studentName=($("studentFirstName").value.trim()+" "+$("studentLastName").value.trim()).trim();
  const parentName=($("parentFirstName").value.trim()+" "+$("parentLastName").value.trim()).trim();
  const email=$("email").value.trim(),phone=$("phone").value.trim(),grade=$("grade").value,age=$("age").value;
  if(!email){$("parentMessage").textContent="Email is required.";return}
  const d=dates()[0],studentId=id(),rec={id:id(),studentId,studentName,parentName,email,phone,age,grade,group:teacherGroup(grade),date:d,checkedInAt:new Date().toISOString(),present:false,
    allergies:$("allergies").value.trim(),photoPermission:$("photoPermission").checked,emergencyPermission:$("emergencyPermission").checked};
  state.records.push(rec);
  state.students.push({studentId,studentName,parentName,email,phone,age,grade,group:rec.group,lastName:$("studentLastName").value.trim().toLowerCase(),
    allergies:rec.allergies,photoPermission:rec.photoPermission,emergencyPermission:rec.emergencyPermission});
  state.roster.push({studentId,studentName,grade,group:rec.group});
  save();$("parentMessage").textContent=`${studentName} checked in.`;$("parentMessage").classList.remove("hidden");e.target.reset();formatPhone($("phone"));await sync({action:"checkin",record:rec})
});

$("lookupFamily").addEventListener("click",()=>{
  const q=$("lookupLastName").value.trim().toLowerCase();
  const found=state.students.filter(s=>s.lastName===q);
  $("familyResults").innerHTML=found.length?found.map(s=>`<div class="card"><strong>${esc(s.studentName)}</strong><div class="muted">${esc(s.grade)} · ${esc(s.age)}</div>
  <button class="primary" onclick="returnCheckin('${s.studentId}')">Check In</button></div>`).join(""):"<p class='muted'>No returning students found. The student must complete new-student check-in first.</p>"
});
window.returnCheckin=async sid=>{
  const s=state.students.find(x=>x.studentId===sid);if(!s)return;
  const d=dates()[0],r={id:id(),studentId:s.studentId,studentName:s.studentName,parentName:s.parentName,email:s.email,phone:s.phone,age:s.age,grade:s.grade,group:s.group,date:d,checkedInAt:new Date().toISOString(),present:false};
  state.records.push(r);save();$("parentMessage").textContent=`${s.studentName} checked in.`;$("parentMessage").classList.remove("hidden");await sync({action:"checkin",record:r})
};

$("teacherDate").addEventListener("change",renderTeacher);$("adminDate").addEventListener("change",renderAdmin);
document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");$(b.dataset.view).classList.add("active");
  if(b.dataset.view==="teacher")renderTeacher();if(b.dataset.view==="admin")renderAdmin()
}));
document.querySelectorAll(".teacher-tab").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".teacher-tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeGroup=b.dataset.group;renderTeacher()
}));
$("teacherForm").addEventListener("submit",async e=>{e.preventDefault();const first=$("teacherFirstName").value.trim(),last=$("teacherLastName").value.trim(),name=`${first} ${last}`.trim();state.teachers[activeGroup]??=[];state.teachers[activeGroup].push({firstName:first,lastName:last,name});save();await sync({action:"addTeacher",name,firstName:first,lastName:last,group:activeGroup});e.target.reset();renderTeacher()});
$("rosterForm").addEventListener("submit",async e=>{e.preventDefault();const first=$("rosterFirstName").value.trim(),last=$("rosterLastName").value.trim(),grade=$("rosterGrade").value;
  const student={studentId:id(),studentName:`${first} ${last}`,grade,group:teacherGroup(grade)};state.roster.push(student);save();await sync({action:"addRosterStudent",student});$("rosterMessage").textContent=`${student.studentName} was added.`;$("rosterMessage").classList.remove("hidden");e.target.reset();renderTeacher()
});
$("volunteerForm").addEventListener("submit",async e=>{e.preventDefault();const first=$("volunteerFirstName").value.trim(),last=$("volunteerLastName").value.trim(),name=`${first} ${last}`.trim();if(state.volunteers.some(v=>v.name.toLowerCase()===name.toLowerCase()))return;const v={id:id(),firstName:first,lastName:last,name};state.volunteers.push(v);save();await sync({action:"addVolunteer",volunteer:v});$("volunteerMessage").textContent=`${name} was added and will appear on future weeks.`;$("volunteerMessage").classList.remove("hidden");e.target.reset();renderVolunteers()});
$("saveNotes").addEventListener("click",async()=>{const d=selectedDate();state.notes[d]=$("dailyNotes").value;save();await sync({action:"saveNotes",date:d,notes:state.notes[d]});$("notesMessage").textContent="Notes saved.";$("notesMessage").classList.remove("hidden")});
$("deleteWeek").addEventListener("click",async()=>{const d=selectedDate();if(!confirm(`Remove ${fmt(d)} from the weekly calendar? This does not delete old attendance records.`))return;state.deletedWeeks.push(d);save();populateDates();renderAdmin();await sync({action:"deleteWeek",date:d})});

function initLogo(){
  const logo=$("logo");
  logo.src="logo.png";
  logo.onerror=()=>{logo.style.display="none"}
}
populateDates();initLogo();renderTeacher();renderAdmin();
