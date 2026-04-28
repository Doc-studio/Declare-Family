/**
 * ================================================================
 * DECLARE FAMILY — Shared Database Layer (declare-db.js)
 * All pages share this single source of truth via localStorage.
 * ================================================================
 */
(function(global){
'use strict';

/* ── STORAGE KEYS ────────────────────────────────────────── */
var KEYS = {
  users:           'df_users',
  session:         'loggedInUser',
  hubMessages:     'df_hubMessages',
  classComments:   'df_classComments',
  achievements:    'df_achievements',
  projects:        'df_projects',
  talents:         'df_talents',
  prayerWall:      'df_prayerWall',
  broadcasts:      'df_broadcasts',
  sessions:        'df_sessions',
  notifications:   'df_notifications',
  onlineHeartbeat: 'df_online_',
  pioneerCodes:    'approvedPioneerCodes',
  pioneerReqs:     'pioneerRequests',
  profileDone:     'profileSetupDone_',
  talentLikes:     'df_talentLikes',
  reactions:       'df_reactions',
  connections:     'df_connections',
  threadMessages:  'df_threadMessages',
};

/* ── LOW-LEVEL HELPERS ───────────────────────────────────── */
function get(key){
  try{ return JSON.parse(localStorage.getItem(key)); }
  catch(e){ return null; }
}
function set(key,val){
  try{ localStorage.setItem(key,JSON.stringify(val)); return true; }
  catch(e){ return false; }
}
function ts(){ return Date.now(); }
function uid(){ return ts() + Math.floor(Math.random()*9999); }

function esc(str){
  if(str==null)return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function fmtTime(t){
  if(!t)return '';
  var d=new Date(t);
  var now=new Date();
  var diff=now-d;
  if(diff<60000)return 'Just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  if(diff<604800000)return Math.floor(diff/86400000)+'d ago';
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

/* ── SESSION / AUTH ──────────────────────────────────────── */
function currentUser(){
  var s = get(KEYS.session);
  // Also check legacy key
  if(!s){ try{ s = JSON.parse(localStorage.getItem('loggedInUser')); }catch(e){} }
  if(!s) return null;
  // Refresh from merged users store to get latest data
  var users = getUsers();
  var found = users.find(function(u){ return u.email===s.email; });
  return found || s;
}

function isLeader(u){
  if(!u) return false;
  var r = (u.role||'').toLowerCase();
  return r==='leader'||r==='admin';
}

function isLoggedIn(){
  if(get(KEYS.session)) return true;
  try{ return !!JSON.parse(localStorage.getItem('loggedInUser')); }catch(e){ return false; }
}

function requireLogin(redirectUrl){
  if(!isLoggedIn()){
    window.location.href = redirectUrl || 'login.html';
    return false;
  }
  return true;
}

function logout(){
  localStorage.removeItem(KEYS.session);
  window.location.href = 'login.html';
}

/* ── ONLINE PRESENCE ─────────────────────────────────────── */
function heartbeat(){
  var u = currentUser();
  if(!u) return;
  var key = KEYS.onlineHeartbeat + u.email;
  localStorage.setItem(key, String(ts()));
}

function getOnlineUsers(windowMs){
  windowMs = windowMs || 120000; // 2 minutes
  var users = get(KEYS.users) || [];
  var now = ts();
  return users.filter(function(u){
    var t = parseInt(localStorage.getItem(KEYS.onlineHeartbeat + u.email)||'0');
    return (now - t) < windowMs;
  });
}

function getOnlineCount(){
  return getOnlineUsers().length;
}

/* ── NOTIFICATIONS ───────────────────────────────────────── */
function pushNotification(note){
  var list = get(KEYS.notifications) || [];
  note.id   = note.id || uid();
  note.time = note.time || ts();
  note.read = false;
  list.unshift(note);
  if(list.length > 50) list = list.slice(0,50);
  set(KEYS.notifications, list);
}

function getNotifications(email){
  var list = get(KEYS.notifications) || [];
  if(email) list = list.filter(function(n){ return !n.targetEmail || n.targetEmail===email; });
  return list;
}

function markNotificationsRead(){
  var list = get(KEYS.notifications) || [];
  list.forEach(function(n){ n.read=true; });
  set(KEYS.notifications, list);
}

function getUnreadCount(email){
  return getNotifications(email).filter(function(n){ return !n.read; }).length;
}

/* ── HUB MESSAGES (community feed) ──────────────────────── */
function getHubMessages(){
  var msgs = get(KEYS.hubMessages) || [];
  return msgs.sort(function(a,b){ return b.time - a.time; });
}

function pushHubMessage(msg){
  var list = get(KEYS.hubMessages) || [];
  msg.id        = msg.id || uid();
  msg.time      = msg.time || ts();
  msg.reactions = msg.reactions || {};
  msg.replyCount= msg.replyCount || 0;
  list.unshift(msg);
  if(list.length > 200) list = list.slice(0,200);
  set(KEYS.hubMessages, list);

  // Notify all members of new post (non-bot)
  if(!msg.isBot && msg.name){
    pushNotification({
      type:    'new_post',
      icon:    '💬',
      title:   msg.name + ' posted in the Hub',
      body:    (msg.text||'').slice(0,80),
      link:    'hub.html',
      poster:  msg.name,
    });
  }
  return msg;
}

function deleteHubMessage(id){
  var list = get(KEYS.hubMessages) || [];
  set(KEYS.hubMessages, list.filter(function(m){ return m.id!=id; }));
}

function reactToMessage(msgId, emoji, userEmail){
  var list = get(KEYS.hubMessages) || [];
  var msg  = list.find(function(m){ return m.id==msgId; });
  if(!msg) return;
  msg.reactions = msg.reactions || {};
  msg.reactions[emoji] = msg.reactions[emoji] || [];
  var idx = msg.reactions[emoji].indexOf(userEmail);
  if(idx>=0){
    msg.reactions[emoji].splice(idx,1);
  } else {
    // Remove other reactions by this user first (one reaction per user)
    Object.keys(msg.reactions).forEach(function(e){
      var i2 = (msg.reactions[e]||[]).indexOf(userEmail);
      if(i2>=0) msg.reactions[e].splice(i2,1);
    });
    msg.reactions[emoji].push(userEmail);
  }
  set(KEYS.hubMessages, list);
}

/* ── CLASS COMMENTS (classroom.html / academy.html) ─────── */
function getClassComments(classKey){
  var all = get(KEYS.classComments) || {};
  return (all[classKey]||[]).sort(function(a,b){ return a.time-b.time; });
}

function pushClassComment(classKey, comment){
  var all = get(KEYS.classComments) || {};
  all[classKey] = all[classKey] || [];
  comment.id   = comment.id || uid();
  comment.time = comment.time || ts();
  all[classKey].push(comment);
  if(all[classKey].length > 100) all[classKey] = all[classKey].slice(-100);
  set(KEYS.classComments, all);

  // Notify
  if(comment.author && !comment.isBot){
    pushNotification({
      type:  'class_comment',
      icon:  '🎓',
      title: comment.author + ' posted in ' + (classKey||'class'),
      body:  (comment.text||'').slice(0,80),
      link:  'classroom.html',
    });
  }
  return comment;
}

function deleteClassComment(classKey, commentId){
  var all = get(KEYS.classComments) || {};
  all[classKey] = (all[classKey]||[]).filter(function(c){ return c.id!=commentId; });
  set(KEYS.classComments, all);
}

/* ── ACHIEVEMENTS ────────────────────────────────────────── */
function getAchievements(){
  return (get(KEYS.achievements)||[]).sort(function(a,b){ return b.time-a.time; });
}

function pushAchievement(ach){
  var list = get(KEYS.achievements) || [];
  ach.id   = ach.id || uid();
  ach.time = ach.time || ts();
  list.unshift(ach);
  set(KEYS.achievements, list);
  pushNotification({
    type:  'achievement',
    icon:  '🏆',
    title: 'New Achievement: ' + (ach.title||''),
    body:  (ach.body||'').slice(0,80),
    link:  'achievements.html',
  });
  return ach;
}

function deleteAchievement(id){
  var list = get(KEYS.achievements) || [];
  set(KEYS.achievements, list.filter(function(a){ return a.id!=id; }));
}

/* ── PROJECTS ────────────────────────────────────────────── */
function getProjects(){
  return (get(KEYS.projects)||[]).sort(function(a,b){ return b.time-a.time; });
}

function pushProject(proj){
  var list = get(KEYS.projects) || [];
  proj.id   = proj.id || uid();
  proj.time = proj.time || ts();
  list.unshift(proj);
  set(KEYS.projects, list);
  pushNotification({
    type:  'project',
    icon:  '🚀',
    title: 'New Project: ' + (proj.title||''),
    body:  (proj.desc||'').slice(0,80),
    link:  'projects.html',
  });
  return proj;
}

function deleteProject(id){
  var list = get(KEYS.projects) || [];
  set(KEYS.projects, list.filter(function(p){ return p.id!=id; }));
}

/* ── TALENTS ─────────────────────────────────────────────── */
function getTalents(){
  return (get(KEYS.talents)||[]).sort(function(a,b){
    if(a.pinned && !b.pinned) return -1;
    if(!a.pinned && b.pinned) return 1;
    return b.time - a.time;
  });
}

function pushTalent(t){
  var list = get(KEYS.talents) || [];
  t.id      = t.id || uid();
  t.time    = t.time || ts();
  t.likes   = t.likes || [];
  t.comments= t.comments || [];
  list.unshift(t);
  set(KEYS.talents, list);
  pushNotification({
    type:  'talent',
    icon:  '🎨',
    title: (t.author||'Someone') + ' shared a talent: ' + (t.title||''),
    link:  'talents.html',
  });
  return t;
}

function deleteTalent(id){
  var list = get(KEYS.talents) || [];
  set(KEYS.talents, list.filter(function(t){ return t.id!=id; }));
}

function likeTalent(id, userEmail){
  var list = get(KEYS.talents) || [];
  var t    = list.find(function(x){ return x.id==id; });
  if(!t) return;
  t.likes  = t.likes || [];
  var idx  = t.likes.indexOf(userEmail);
  if(idx>=0) t.likes.splice(idx,1);
  else t.likes.push(userEmail);
  set(KEYS.talents, list);
}

function commentTalent(id, comment){
  var list = get(KEYS.talents) || [];
  var t    = list.find(function(x){ return x.id==id; });
  if(!t) return;
  t.comments = t.comments || [];
  comment.id = comment.id || uid();
  comment.time = comment.time || ts();
  t.comments.push(comment);
  set(KEYS.talents, list);
  return comment;
}

function pinTalent(id, pinned){
  var list = get(KEYS.talents) || [];
  var t    = list.find(function(x){ return x.id==id; });
  if(t) t.pinned = pinned;
  set(KEYS.talents, list);
}

/* ── PRAYER WALL ─────────────────────────────────────────── */
function getPrayerPosts(){
  return (get(KEYS.prayerWall)||[]).sort(function(a,b){ return b.time-a.time; });
}

function pushPrayerPost(post){
  var list = get(KEYS.prayerWall) || [];
  post.id       = post.id || uid();
  post.time     = post.time || ts();
  post.amens    = post.amens || [];
  post.answered = post.answered || false;
  list.unshift(post);
  if(list.length > 150) list = list.slice(0,150);
  set(KEYS.prayerWall, list);
  pushNotification({
    type:  'prayer',
    icon:  '🕊️',
    title: (post.author||'Someone') + ' shared a ' + (post.type||'prayer'),
    link:  'faith.html',
  });
  return post;
}

function deletePrayerPost(id){
  var list = get(KEYS.prayerWall) || [];
  set(KEYS.prayerWall, list.filter(function(p){ return p.id!=id; }));
}

function amenPrayerPost(id, userEmail){
  var list = get(KEYS.prayerWall) || [];
  var p    = list.find(function(x){ return x.id==id; });
  if(!p) return;
  p.amens  = p.amens || [];
  var idx  = p.amens.indexOf(userEmail);
  if(idx>=0) p.amens.splice(idx,1);
  else p.amens.push(userEmail);
  set(KEYS.prayerWall, list);
}

function markAnswered(id){
  var list = get(KEYS.prayerWall) || [];
  var p    = list.find(function(x){ return x.id==id; });
  if(p) p.answered = true;
  set(KEYS.prayerWall, list);
}

/* ── BROADCASTS ──────────────────────────────────────────── */
function getBroadcasts(){
  return (get(KEYS.broadcasts)||[]).sort(function(a,b){ return b.time-a.time; });
}

function pushBroadcast(b){
  var list = get(KEYS.broadcasts) || [];
  b.id   = b.id || uid();
  b.time = b.time || ts();
  list.unshift(b);
  set(KEYS.broadcasts, list);
  // Also push to hub
  pushHubMessage({
    id:     uid(),
    name:   '📢 Leadership Broadcast',
    role:   'leader',
    text:   '[BROADCAST] ' + (b.title||'') + ': ' + (b.body||''),
    type:   'broadcast',
    time:   ts(),
    isBot:  false,
  });
  pushNotification({
    type:  'broadcast',
    icon:  '📢',
    title: 'New Broadcast: ' + (b.title||''),
    body:  (b.body||'').slice(0,80),
    link:  'hub.html',
  });
  return b;
}

function deleteBroadcast(id){
  var list = get(KEYS.broadcasts) || [];
  set(KEYS.broadcasts, list.filter(function(b){ return b.id!=id; }));
}

/* ── SESSION SCHEDULE ────────────────────────────────────── */
function getSessions(){
  return (get(KEYS.sessions)||[]).sort(function(a,b){ return a.time-b.time; });
}

function pushSession(s){
  var list = get(KEYS.sessions) || [];
  s.id   = s.id || uid();
  s.time = s.time || ts();
  list.push(s);
  set(KEYS.sessions, list);
  pushNotification({
    type:  'session',
    icon:  '🗓️',
    title: 'Session Scheduled: ' + (s.title||''),
    body:  'Join at ' + (s.timeLabel||''),
    link:  'thread.html',
  });
  return s;
}

function deleteSession(id){
  var list = get(KEYS.sessions) || [];
  set(KEYS.sessions, list.filter(function(s){ return s.id!=id; }));
}

function getUpcomingSession(){
  var sessions = getSessions();
  var now = ts();
  return sessions.find(function(s){ return s.time > now - 3600000; }) || null;
}

/* ── THREAD MESSAGES (The Square chat) ───────────────────── */
function getThreadMessages(){
  return (get(KEYS.threadMessages)||[]).sort(function(a,b){ return a.time-b.time; });
}

function pushThreadMessage(msg){
  var list = get(KEYS.threadMessages) || [];
  msg.id   = msg.id || uid();
  msg.time = msg.time || ts();
  list.push(msg);
  if(list.length > 300) list = list.slice(-300);
  set(KEYS.threadMessages, list);
  return msg;
}

/* ── PIONEER ACCESS CODES ────────────────────────────────── */
function generatePioneerCode(email, role){
  var codes = get(KEYS.pioneerCodes) || {};
  var code  = 'DF-PNR-' + Math.random().toString(36).slice(2,8).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  codes[code] = { email:email, role:role, createdAt:new Date().toISOString(), usedAt:null };
  set(KEYS.pioneerCodes, codes);
  return code;
}

function getPioneerRequests(){
  var dbReqs  = get(KEYS.pioneerReqs) || [];
  var legReqs = [];
  try{ legReqs = JSON.parse(localStorage.getItem('pioneerRequests')) || []; }catch(e){}
  legReqs.forEach(function(lr){
    if(!dbReqs.find(function(dr){ return dr.id===lr.id || dr.email===lr.email; })){
      dbReqs.push(lr);
    }
  });
  return dbReqs;
}

function approvePioneerRequest(reqId){
  var reqs = getPioneerRequests();
  var req  = reqs.find(function(r){ return r.id==reqId; });
  if(!req) return null;
  req.status = 'approved';
  set(KEYS.pioneerReqs, reqs);
  return generatePioneerCode(req.email, req.roleRequested||'leader');
}

function denyPioneerRequest(reqId){
  var reqs = getPioneerRequests().filter(function(r){ return r.id!=reqId; });
  set(KEYS.pioneerReqs, reqs);
}

/* ── USERS ───────────────────────────────────────────────── */
function getUsers(){
  var dbUsers  = get(KEYS.users) || [];
  // Also read from legacy 'users' key used by main.html/login.html
  var legUsers = [];
  try{ legUsers = JSON.parse(localStorage.getItem('users')) || []; }catch(e){}
  // Merge: prefer DB records, add any legacy-only accounts
  legUsers.forEach(function(lu){
    if(!dbUsers.find(function(du){ return du.email===lu.email; })){
      dbUsers.push(lu);
    }
  });
  // Keep df_users in sync
  if(legUsers.length) set(KEYS.users, dbUsers);
  return dbUsers;
}

function getAllMembers(){
  return getUsers().filter(function(u){ return u.role==='member'||!u.role; });
}

function getAllPioneers(){
  return getUsers().filter(function(u){ return isLeader(u); });
}

function updateUser(email, updates){
  var users = getUsers();
  var idx   = users.findIndex(function(u){ return u.email===email; });
  if(idx<0) return false;
  users[idx] = Object.assign({}, users[idx], updates);
  set(KEYS.users, users);
  // Update session if it's the current user
  var sess = get(KEYS.session);
  if(sess && sess.email===email){
    var updated = Object.assign({},sess,updates);
    delete updated.password; delete updated.passwordHash;
    set(KEYS.session, updated);
  }
  return users[idx];
}

/* ── CONNECTIONS ─────────────────────────────────────────── */
function getConnections(email){
  var all = get(KEYS.connections) || {};
  return all[email] || [];
}

function addConnection(fromEmail, toEmail){
  var all = get(KEYS.connections) || {};
  all[fromEmail] = all[fromEmail] || [];
  if(!all[fromEmail].includes(toEmail)){
    all[fromEmail].push(toEmail);
  }
  // Bidirectional
  all[toEmail] = all[toEmail] || [];
  if(!all[toEmail].includes(fromEmail)){
    all[toEmail].push(fromEmail);
  }
  set(KEYS.connections, all);

  // Notify the target user
  var fromUser = getUsers().find(function(u){ return u.email===fromEmail; });
  if(fromUser){
    pushNotification({
      type:        'connection',
      icon:        '🤝',
      title:       (fromUser.name||fromEmail) + ' connected with you',
      link:        'profile.html',
      targetEmail: toEmail,
    });
  }
}

function removeConnection(fromEmail, toEmail){
  var all = get(KEYS.connections) || {};
  if(all[fromEmail]) all[fromEmail] = all[fromEmail].filter(function(e){ return e!==toEmail; });
  if(all[toEmail])   all[toEmail]   = all[toEmail].filter(function(e){ return e!==fromEmail; });
  set(KEYS.connections, all);
}

function isConnected(email1, email2){
  var c = getConnections(email1);
  return c.includes(email2);
}

/* ── MEMBER SEARCH ───────────────────────────────────────── */
function searchMembers(query){
  var q = (query||'').toLowerCase();
  return getUsers().filter(function(u){
    return (u.name||'').toLowerCase().includes(q) ||
           (u.email||'').toLowerCase().includes(q) ||
           (u.memberID||'').toLowerCase().includes(q);
  });
}

/* ── STATS ───────────────────────────────────────────────── */
function getStats(){
  var users    = getUsers();
  var online   = getOnlineUsers();
  return {
    totalMembers:  users.length,
    totalPioneers: users.filter(isLeader).length,
    onlineCount:   online.length,
    onlinePioneers:online.filter(isLeader).length,
    onlineMembers: online.filter(function(u){ return !isLeader(u); }).length,
    classPosts:    Object.values(get(KEYS.classComments)||{}).reduce(function(a,c){ return a+c.length; },0),
    broadcasts:    getBroadcasts().length,
    projects:      getProjects().length,
    achievements:  getAchievements().length,
    pendingReqs:   getPioneerRequests().filter(function(r){ return r.status==='pending'; }).length,
    prayerCount:   getPrayerPosts().length,
    talentCount:   getTalents().length,
  };
}

/* ── PUBLISH ─────────────────────────────────────────────── */
global.DB = {
  KEYS:KEYS,
  get:get, set:set, ts:ts, uid:uid, esc:esc, fmtTime:fmtTime,

  // Auth
  currentUser:currentUser, isLeader:isLeader, isLoggedIn:isLoggedIn,
  requireLogin:requireLogin, logout:logout,

  // Presence
  heartbeat:heartbeat, getOnlineUsers:getOnlineUsers, getOnlineCount:getOnlineCount,

  // Notifications
  pushNotification:pushNotification, getNotifications:getNotifications,
  markNotificationsRead:markNotificationsRead, getUnreadCount:getUnreadCount,

  // Hub / Feed
  getHubMessages:getHubMessages, pushHubMessage:pushHubMessage,
  deleteHubMessage:deleteHubMessage, reactToMessage:reactToMessage,

  // Class comments
  getClassComments:getClassComments, pushClassComment:pushClassComment,
  deleteClassComment:deleteClassComment,

  // Achievements
  getAchievements:getAchievements, pushAchievement:pushAchievement,
  deleteAchievement:deleteAchievement,

  // Projects
  getProjects:getProjects, pushProject:pushProject, deleteProject:deleteProject,

  // Talents
  getTalents:getTalents, pushTalent:pushTalent, deleteTalent:deleteTalent,
  likeTalent:likeTalent, commentTalent:commentTalent, pinTalent:pinTalent,

  // Prayer
  getPrayerPosts:getPrayerPosts, pushPrayerPost:pushPrayerPost,
  deletePrayerPost:deletePrayerPost, amenPrayerPost:amenPrayerPost,
  markAnswered:markAnswered,

  // Broadcasts
  getBroadcasts:getBroadcasts, pushBroadcast:pushBroadcast, deleteBroadcast:deleteBroadcast,

  // Sessions / Schedule
  getSessions:getSessions, pushSession:pushSession,
  deleteSession:deleteSession, getUpcomingSession:getUpcomingSession,

  // Thread
  getThreadMessages:getThreadMessages, pushThreadMessage:pushThreadMessage,

  // Pioneer codes
  generatePioneerCode:generatePioneerCode, getPioneerRequests:getPioneerRequests,
  approvePioneerRequest:approvePioneerRequest, denyPioneerRequest:denyPioneerRequest,

  // Users
  getUsers:getUsers, getAllMembers:getAllMembers, getAllPioneers:getAllPioneers,
  updateUser:updateUser, searchMembers:searchMembers,

  // Connections
  getConnections:getConnections, addConnection:addConnection,
  removeConnection:removeConnection, isConnected:isConnected,

  // Stats
  getStats:getStats,
};

/* ── AUTO HEARTBEAT (every 30s while page is open) ───────── */
setInterval(function(){
  if(isLoggedIn()) heartbeat();
}, 30000);

// Initial heartbeat
if(isLoggedIn()) heartbeat();

})(window);
