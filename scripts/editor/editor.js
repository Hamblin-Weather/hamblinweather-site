const get = (id) => document.getElementById(id);
const form = get('update');
const drafts = get('drafts');
const load = get('load');
const dialog = get('confirm');
const message = get('message');
const add = get('add');
const save = get('save');
const posts = get('posts');
const edit = get('edit');
const newUpdate = get('new-update');
const remove = get('delete-update');
const dateField = get('publication-date');
const timeField = get('publication-time');
const confirm = get('confirm-add');
const isBlog = (category) => category === 'Blog post';
let pending;
let editing;

function note(text, error = false) {
  message.textContent = text;
  message.toggleAttribute('data-error', error);
}

function centralNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (key) => parts.find(({ type }) => type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function data() {
  const dateTime = dateField.value && timeField.value ? dateField.value + 'T' + timeField.value : dateField.value;
  return { ...Object.fromEntries(new FormData(form)), dateTime };
}

function fill(values) {
  for (const key of ['title', 'description', 'body', 'category']) form.elements.namedItem(key).value = values[key];
  const [date, time] = values.dateTime.split('T');
  dateField.value = date;
  timeField.value = time || '';
  preview();
}

function preview() {
  const values = data();
  add.textContent = editing ? 'Save changes' : isBlog(values.category) ? 'Add to Blog' : 'Add to local site';
  const hasTime = values.dateTime.includes('T');
  const stamp = new Date(values.dateTime + (hasTime ? ':00Z' : 'T12:00:00Z'));
  const formatted = Number.isFinite(+stamp) ? ' · ' + new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long', ...(hasTime && { timeStyle: 'short' }), timeZone: 'UTC',
  }).format(stamp) + (hasTime ? ' CT' : '') : '';
  get('preview-meta').textContent = values.category + formatted;
  get('preview-title').textContent = values.title.trim() || 'Your title';
  get('preview-summary').textContent = values.description.trim() || 'Your summary will appear here.';
  const paragraphs = (values.body.trim() || 'Your update will appear here.').split(/\n[ \t]*\n+/).map((text) => {
    const p = document.createElement('p');
    p.textContent = text.trim().split('\n').map((line) => line.trim()).join(' ');
    return p;
  });
  get('preview-body').replaceChildren(...paragraphs);
}

async function api(path, values, method = 'POST') {
  const response = await fetch(path, values === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The editor did not respond.');
  return result;
}

async function refreshDrafts(selected = '') {
  const entries = await api('/drafts');
  drafts.replaceChildren(new Option('Choose a saved draft', ''), ...entries.map(({ id, title }) => {
    const saved = new Date(Number(id.split('-')[0]));
    const timestamp = Number.isFinite(+saved) ? ' · ' + new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Chicago',
    }).format(saved) + ' CT' : '';
    return new Option((title || 'Untitled draft') + timestamp, id);
  }));
  drafts.value = selected;
  load.disabled = !drafts.value;
}

async function refreshPosts(selected = '') {
  const entries = await api('/updates');
  posts.replaceChildren(new Option('Choose an update', ''), ...entries.map(({ slug, title }) => new Option(title + ' · ' + slug, slug)));
  posts.value = selected;
  edit.disabled = !posts.value;
}

function setEditing(post) {
  editing = post;
  newUpdate.hidden = remove.hidden = !post;
  save.hidden = Boolean(post);
  get('editing').hidden = !post;
  get('editing').textContent = post ? 'Editing ' + post.title : '';
  get('body-hint').textContent = post?.markdown ? 'This update uses Markdown.' : 'Use a blank line between paragraphs.';
  timeField.required = !post;
}

function freshForm() {
  setEditing(undefined);
  posts.value = '';
  edit.disabled = true;
  fill({ title: '', description: '', body: '', category: 'Station notes', dateTime: centralNow() });
}

async function perform(action) {
  save.disabled = add.disabled = load.disabled = edit.disabled = remove.disabled = newUpdate.disabled = true;
  try { await action(); }
  catch (error) { note(error.message || 'The editor could not save the update.', true); }
  finally {
    save.disabled = add.disabled = remove.disabled = newUpdate.disabled = false;
    load.disabled = !drafts.value;
    edit.disabled = !posts.value;
  }
}

function noteSaved(slug, category) {
  const blog = isBlog(category);
  note(blog ? 'Blog post saved. ' : 'Update saved. ');
  const link = document.createElement('a');
  link.href = 'http://localhost:4321/' + (blog ? 'blog/' : 'updates/') + encodeURIComponent(slug) + '/';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = blog ? link.href : 'View update in the local preview';
  message.append(link);
  if (blog) {
    const command = document.createElement('code');
    command.textContent = 'npm.cmd run build';
    message.append(' — To rebuild the static site, run ', command, ' from the website folder.');
  }
}

function ask(title, text, label, action) {
  get('confirm-title').textContent = title;
  get('confirm-text').textContent = text;
  confirm.textContent = label;
  confirm.className = label === 'Delete update' ? 'danger' : 'primary';
  pending = action;
  dialog.showModal();
}

form.addEventListener('input', preview);
drafts.addEventListener('change', () => { load.disabled = !drafts.value; });
posts.addEventListener('change', () => { edit.disabled = !posts.value; });
edit.addEventListener('click', () => void perform(async () => {
  const post = await api('/updates/' + encodeURIComponent(posts.value));
  setEditing(post);
  fill(post);
  note('Update loaded.');
  get('title').focus();
}));
newUpdate.addEventListener('click', () => {
  freshForm();
  note('');
  get('title').focus();
});
load.addEventListener('click', () => void perform(async () => {
  const draft = await api('/drafts/' + encodeURIComponent(drafts.value));
  setEditing(undefined);
  posts.value = '';
  fill(draft);
  note('Draft loaded. Saving creates a new copy.');
  get('title').focus();
}));
save.addEventListener('click', () => void perform(async () => {
  const { id } = await api('/drafts', data());
  note('Draft saved locally. It won’t appear on the website.');
  await refreshDrafts(id);
}));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = data();
  if (editing) {
    const { slug, revision } = editing;
    void perform(async () => {
      const post = await api('/updates/' + encodeURIComponent(slug), { ...values, revision }, 'PUT');
      setEditing(post);
      noteSaved(post.slug, post.category);
      await refreshPosts(post.slug);
    });
    return;
  }
  const blog = isBlog(values.category);
  ask(blog ? 'Add this post to Blog?' : 'Add this update?', 'This creates a new post in your local website project. The live preview will pick it up automatically.', blog ? 'Add to Blog' : 'Add update', async () => {
    const { slug } = await api('/updates', values);
    noteSaved(slug, values.category);
    await refreshPosts(slug);
  });
});
remove.addEventListener('click', () => {
  const { slug, title, revision, category } = editing;
  const section = isBlog(category) ? 'Blog' : 'Weather Updates';
  ask('Delete this update?', '“' + title + '” will be removed from ' + section + '.', 'Delete update', async () => {
    await api('/updates/' + encodeURIComponent(slug), { revision }, 'DELETE');
    freshForm();
    note('Update removed from ' + section + '.');
    await refreshPosts();
  });
});
get('cancel').addEventListener('click', () => dialog.close());
confirm.addEventListener('click', () => {
  const action = pending;
  dialog.close();
  if (action) void perform(action);
});
dialog.addEventListener('close', () => { pending = undefined; });

const [initialDate, initialTime] = centralNow().split('T');
dateField.value = initialDate;
timeField.value = initialTime;
void api('/categories').then((categories) => {
  get('category').replaceChildren(...categories.map((category) => new Option(category, category)));
  if (editing) get('category').value = editing.category;
  preview();
}).catch((error) => note(error.message, true));
void refreshDrafts().catch((error) => note(error.message, true));
void refreshPosts().catch((error) => note(error.message, true));
