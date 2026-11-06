const $ = (s) => document.querySelector(s);
const esc = (s="") => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function message(text, type="success") {
  const el = $("#formMessage");
  if (el) { el.className = "message " + type; el.textContent = text; }
}
function dateText(date) {
  return date ? new Date(date).toLocaleDateString() : "";
}
function documentCard(d, shared=false) {
  const download = shared ? `/api/shared/${d.document_id}/download` : `/api/documents/${d.document_id}/download`;
  return `<div class="document-card"><div class="document-info"><div class="file-icon">📄</div><div><strong>${esc(d.title)}</strong><p>${esc(d.category_name || "Uncategorized")} · ${dateText(d.upload_date)}</p></div></div><div><a class="btn btn-small" href="${download}">Download</a> ${shared ? "" : `<button class="btn btn-small btn-danger delete-doc" data-id="${d.document_id}">Delete</button>`}</div></div>`;
}
async function loadCategories(selectId) {
  const categories = await api("/api/categories");
  const select = $(selectId);
  if (select) select.innerHTML = '<option value="">Select category</option>' + categories.map(c=>`<option value="${c.category_id}">${esc(c.category_name)}</option>`).join("");
  const list = $("#categoriesList");
  if (list) list.innerHTML = categories.map(c=>`<div class="card"><div class="card-icon">📁</div><h3>${esc(c.category_name)}</h3><p>${esc(c.description || "Document category")}</p></div>`).join("") || '<p class="empty">No categories yet.</p>';
}
async function loadDocuments() {
  const docs = await api("/api/documents");
  const list = $("#documentsList");
  if (list) list.innerHTML = docs.map(d=>documentCard(d)).join("") || '<p class="empty">No documents uploaded yet. Upload your first file above.</p>';
  const accessSelect = $("#accessDocumentSelect");
  if (accessSelect) accessSelect.innerHTML = '<option value="">Select document</option>' + docs.map(d=>`<option value="${d.document_id}">${esc(d.title)}</option>`).join("");
  document.querySelectorAll(".delete-doc").forEach(btn => btn.addEventListener("click", async()=>{
    if (!confirm("Delete this document?")) return;
    try { await api(`/api/documents/${btn.dataset.id}`, {method:"DELETE"}); await loadDocuments(); }
    catch(e){ alert(e.message); }
  }));
}
async function init() {
  const me = await api("/api/me");
  const protectedPage = ["dashboard.html","documents.html","categories.html","access.html"].some(p=>location.pathname.endsWith(p));
  if (protectedPage && !me.user) { location.href="login.html"; return; }
  if (me.user) {
    const name = $(".dashboard-header h1");
    if (name && location.pathname.endsWith("dashboard.html")) name.textContent = `Welcome, ${me.user.name}`;
  }

  $("#loginForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    try {
      const data = await api("/api/login",{method:"POST",body:new FormData(e.target)});
      location.href=data.redirect;
    } catch(err){ message(err.message,"error"); }
  });
  $("#registerForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    try {
      const data = await api("/api/register",{method:"POST",body:new FormData(e.target)});
      location.href=data.redirect;
    } catch(err){ message(err.message,"error"); }
  });
  $("#logoutBtn")?.addEventListener("click", async e=>{
    e.preventDefault(); await api("/api/logout",{method:"POST"}); location.href="index.html";
  });

  if ($("#totalDocs")) {
    const data = await api("/api/dashboard");
    $("#totalDocs").textContent=data.total;
    $("#totalCategories").textContent=data.categories;
    $("#recentDocs").innerHTML=data.recent.map(d=>documentCard(d)).join("") || '<p class="empty">No documents uploaded yet.</p>';
  }
  if ($("#documentsList")) {
    await loadCategories("#categorySelect");
    await loadDocuments();
    $("#searchInput")?.addEventListener("input", e=>{
      const q=e.target.value.toLowerCase();
      document.querySelectorAll("#documentsList .document-card").forEach(card=>{
        card.style.display=card.textContent.toLowerCase().includes(q)?"":"none";
      });
    });
  }
  if ($("#categoriesList")) await loadCategories(null);
  $("#uploadForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    try { const data=await api("/api/documents",{method:"POST",body:new FormData(e.target)}); message(data.message); e.target.reset(); await loadDocuments(); }
    catch(err){message(err.message,"error");}
  });
  $("#categoryForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    try { const data=await api("/api/categories",{method:"POST",body:new FormData(e.target)}); message(data.message); e.target.reset(); await loadCategories(null); }
    catch(err){message(err.message,"error");}
  });
  $("#accessForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    try { const data=await api("/api/access",{method:"POST",body:new FormData(e.target)}); message(data.message); e.target.reset(); await loadAccess(); }
    catch(err){message(err.message,"error");}
  });
  if ($("#accessList")) await loadAccess();
}
async function loadAccess(){
  const [items, shared] = await Promise.all([api("/api/access"),api("/api/shared")]);
  const el=$("#accessList");
  if(el) el.innerHTML = items.map(a=>`<div class="document-card"><div><strong>${esc(a.title)}</strong><p>Shared with ${esc(a.name)} (${esc(a.email)}) · ${esc(a.permission)}</p></div></div>`).join("") || '<p class="empty">No access has been granted yet.</p>';
}
document.addEventListener("DOMContentLoaded",()=>init().catch(err=>{console.error(err); if(["dashboard.html","documents.html","categories.html","access.html"].some(p=>location.pathname.endsWith(p))) location.href="login.html";}));
