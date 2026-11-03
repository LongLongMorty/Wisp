(function() {
  const e = React.createElement;
  const {useState, useEffect} = React;

  const root = document.getElementById('root');
  if (!root) return;
  const sessionId = root.dataset.sessionId;
  const route = root.dataset.route;
  const origin = root.dataset.origin;

  function CreateTicket({sessionId, origin}) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [category1, setCategory1] = useState('');
    const [category2, setCategory2] = useState('');
    const [priority, setPriority] = useState('');
    const [assignee, setAssignee] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [categories, setCategories] = useState({});
    const [users, setUsers] = useState([]);

    useEffect(() => {
      fetch(`${origin}/api/${sessionId}/categories`)
        .then(r => r.json())
        .then(d => {
          setCategories(d.categories);
          const first = Object.keys(d.categories)[0];
          setCategory1(first);
          setCategory2(d.categories[first][0]);
        });
      fetch(`${origin}/api/${sessionId}/users`)
        .then(r => r.json())
        .then(d => setUsers(d.users));
    }, []);

    const handleCategory1Change = (ev) => {
      const newCat1 = ev.target.value;
      setCategory1(newCat1);
      setCategory2(categories[newCat1][0]);
    };

    const handlePriorityChange = (ev) => {
      const newPriority = ev.target.value;
      if (priority === 'urgent' && newPriority !== 'urgent') {
        setDueDate('');
      }
      setPriority(newPriority);
    };

    const handleSubmit = async (ev) => {
      ev.preventDefault();
      await fetch(`${origin}/api/${sessionId}/tickets`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title, description, category1, category2, priority, assignee: assignee || null, due_date: dueDate || null})
      });
      window.location.href = `${origin}/ticket-system/s/${sessionId}/list`;
    };

    return e('form', {onSubmit: handleSubmit},
      e('h1', null, '创建工单'),
      e('label', null, '标题 *', e('input', {name: 'title', value: title, onChange: ev => setTitle(ev.target.value), required: true})),
      e('label', null, '描述 *', e('textarea', {name: 'description', value: description, onChange: ev => setDescription(ev.target.value), required: true})),
      e('label', null, '一级分类 *', e('select', {name: 'category1', value: category1, onChange: handleCategory1Change},
        Object.keys(categories).map(c => e('option', {key: c, value: c}, c)))),
      e('label', null, '二级分类 *', e('select', {name: 'category2', value: category2, onChange: ev => setCategory2(ev.target.value)},
        (categories[category1] || []).map(c => e('option', {key: c, value: c}, c)))),
      e('label', null, '优先级 *', e('select', {name: 'priority', value: priority, onChange: handlePriorityChange, required: true},
        e('option', {value: ''}, '请选择'),
        e('option', {value: 'low'}, '低'),
        e('option', {value: 'medium'}, '中'),
        e('option', {value: 'high'}, '高'),
        e('option', {value: 'urgent'}, '紧急'))),
      priority === 'urgent' && e('label', null, '预计解决时间', e('input', {type: 'date', name: 'due_date', value: dueDate, onChange: ev => setDueDate(ev.target.value)})),
      e('label', null, '处理人', e('select', {name: 'assignee', value: assignee, onChange: ev => setAssignee(ev.target.value)},
        e('option', {value: ''}, '未分配'),
        users.map(u => e('option', {key: u.id, value: u.id}, u.name)))),
      e('button', {type: 'submit'}, '提交工单')
    );
  }

  function TicketList() { return e('div', null, 'TicketList placeholder'); }
  function TicketDetail() { return e('div', null, 'TicketDetail placeholder'); }

  function App() {
    if (route === 'create') return e(CreateTicket, {sessionId, origin});
    if (route === 'list') return e(TicketList, {sessionId, origin});
    if (route === 'detail') return e(TicketDetail, {sessionId, origin});
    return e('div', null, 'Unknown route');
  }

  ReactDOM.render(e(App), root);
})();
