(function() {
  const e = React.createElement;
  const {useState, useEffect} = React;

  const root = document.getElementById('root');
  if (!root) return;
  const sessionId = root.dataset.sessionId;
  const route = root.dataset.route;
  const origin = root.dataset.origin;
  const param = root.dataset.param;

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
    const [error, setError] = useState('');

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
      setError('');
      const res = await fetch(`${origin}/api/${sessionId}/tickets`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title, description, category1, category2, priority, assignee: assignee || null, due_date: dueDate || null})
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({error: 'Unknown error'}));
        setError('创建失败: ' + (err.error || err.message || res.statusText));
        return;
      }
      window.location.href = `${origin}/ticket-system/s/${sessionId}/list`;
    };

    return e('form', {onSubmit: handleSubmit},
      e('h1', null, '创建工单'),
      error && e('div', {role: 'alert', style: {padding: '12px', marginBottom: '16px', background: '#ffebe9', border: '1px solid #cf222e', borderRadius: '6px', color: '#cf222e'}}, error),
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

  function TicketList({sessionId, origin}) {
    const [tickets, setTickets] = useState([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [priorityFilter, setPriorityFilter] = useState('all');

    const loadTickets = () => {
      fetch(`${origin}/api/${sessionId}/tickets?status=${statusFilter}&priority=${priorityFilter}`)
        .then(r => r.json())
        .then(d => setTickets(d.tickets));
    };

    useEffect(() => { loadTickets(); }, []);

    return e('div', null,
      e('h1', null, '工单列表'),
      e('a', {href: `${origin}/ticket-system/s/${sessionId}/create`}, '+ 创建工单'),
      e('div', null,
        e('label', null, '状态筛选 ',
          e('select', {value: statusFilter, onChange: ev => setStatusFilter(ev.target.value)},
            e('option', {value: 'all'}, '全部'),
            e('option', {value: 'pending'}, '待处理'),
            e('option', {value: 'processing'}, '处理中'),
            e('option', {value: 'resolved'}, '已解决'),
            e('option', {value: 'closed'}, '已关闭'))),
        e('label', null, ' 优先级 ',
          e('select', {value: priorityFilter, onChange: ev => setPriorityFilter(ev.target.value)},
            e('option', {value: 'all'}, '全部'),
            e('option', {value: 'low'}, '低'),
            e('option', {value: 'medium'}, '中'),
            e('option', {value: 'high'}, '高'),
            e('option', {value: 'urgent'}, '紧急'))),
        e('button', {type: 'button', onClick: loadTickets}, '筛选')),
      e('table', null,
        e('thead', null, e('tr', null,
          e('th', null, 'ID'),
          e('th', null, '标题'),
          e('th', null, '状态'),
          e('th', null, '优先级'),
          e('th', null, '处理人'),
          e('th', null, '操作'))),
        e('tbody', null,
          tickets.map(t => e('tr', {key: t.id},
            e('td', null, t.id),
            e('td', null, t.title),
            e('td', null, t.status),
            e('td', null, t.priority),
            e('td', null, t.assignee || '未分配'),
            e('td', null, e('a', {href: `${origin}/ticket-system/s/${sessionId}/detail/${t.id}`}, '查看'))))))
    );
  }

  function TicketDetail({sessionId, origin, ticketId}) {
    const [ticket, setTicket] = useState(null);
    const [logs, setLogs] = useState([]);
    const [error, setError] = useState('');

    const loadTicket = () => {
      fetch(`${origin}/api/${sessionId}/tickets/${ticketId}`)
        .then(r => r.json())
        .then(d => setTicket(d.ticket));
      fetch(`${origin}/api/${sessionId}/tickets/${ticketId}/audit-logs`)
        .then(r => r.json())
        .then(d => setLogs(d.logs));
    };

    useEffect(() => { loadTicket(); }, []);

    const handleStatusChange = async (newStatus) => {
      setError('');
      const res = await fetch(`${origin}/api/${sessionId}/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({status: newStatus})
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({error: 'Unknown error'}));
        setError('状态变更失败: ' + (err.error || err.message || res.statusText));
        return;
      }
      loadTicket();
    };

    if (!ticket) return e('div', null, '加载中...');

    // The server fixes the acting user to user1; the UI mirrors it only to hide buttons, the server enforces it.
    const currentUser = 'user1';
    const isAssignee = ticket.assignee === currentUser;
    const action = {
      pending: {next: 'processing', label: '开始处理', allowed: true},
      processing: {next: 'resolved', label: '标记已解决', allowed: isAssignee},
      resolved: {next: 'closed', label: '关闭工单', allowed: isAssignee}
    }[ticket.status];

    return e('div', null,
      e('h1', null, `工单详情 - ${ticket.id}`),
      e('dl', null,
        e('dt', null, '标题'), e('dd', null, ticket.title),
        e('dt', null, '描述'), e('dd', null, ticket.description),
        e('dt', null, '一级分类'), e('dd', null, ticket.category1),
        e('dt', null, '二级分类'), e('dd', null, ticket.category2),
        e('dt', null, '状态'), e('dd', null, ticket.status),
        e('dt', null, '优先级'), e('dd', null, ticket.priority),
        e('dt', null, '处理人'), e('dd', null, ticket.assignee || '未分配'),
        e('dt', null, '创建时间'), e('dd', null, ticket.created_at),
        e('dt', null, '更新时间'), e('dd', null, ticket.updated_at),
        ticket.due_date && e('dt', null, '预计解决时间'), ticket.due_date && e('dd', null, ticket.due_date)),
      error && e('div', {role: 'alert', style: {padding: '12px', margin: '16px 0', background: '#ffebe9', border: '1px solid #cf222e', borderRadius: '6px', color: '#cf222e'}}, error),
      e('a', {href: `${origin}/ticket-system/s/${sessionId}/list`}, '返回列表'),
      action && action.allowed && e('button', {onClick: () => handleStatusChange(action.next)}, action.label),
      ticket.status === 'closed' && e('p', null, '工单已关闭，无可用操作'),
      e('h2', null, '审计日志'),
      e('ul', null,
        logs.map(log => e('li', {key: log.id},
          `${log.timestamp} - ${log.action} by ${log.operator}${log.details ? ': ' + log.details : ''}`)))
    );
  }

  function App() {
    if (route === 'create') return e(CreateTicket, {sessionId, origin});
    if (route === 'list') return e(TicketList, {sessionId, origin});
    if (route === 'detail') return e(TicketDetail, {sessionId, origin, ticketId: param});
    return e('div', null, 'Unknown route');
  }

  ReactDOM.render(e(App), root);
})();
