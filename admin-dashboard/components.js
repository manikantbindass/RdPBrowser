export function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (value !== undefined && value !== false) element.setAttribute(name, value === true ? '' : value);
  }
  element.append(...children.flat().filter(child => child !== null && child !== undefined));
  return element;
}

function svg(tag, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function icon(name) {
  const element = svg('svg', { class: 'icon', 'aria-hidden': 'true' });
  element.append(svg('use', { href: '#i-' + name }));
  return element;
}

export const button = (label, onclick, style = '', symbol) =>
  node('button', { type: 'button', class: 'btn ' + style, onclick }, symbol ? icon(symbol) : null, label);
export const chip = (label, tone = 'neutral') => node('span', { class: 'chip ' + tone }, label);
export const muted = text => node('span', { class: 'muted' }, text);
export const code = text => node('code', {}, text || '—');
export const moment = time => time && Number.isFinite(Date.parse(time)) ? new Date(time).toLocaleString() : '—';
export const count = number => typeof number === 'number' ? new Intl.NumberFormat().format(number) : '—';
export const panel = (title, subtitle, content, action = null) => node('section', { class: 'panel' },
  node('header', { class: 'panel-head' }, node('div', {}, node('h2', {}, title), subtitle ? node('p', {}, subtitle) : null), action),
  content);

export function stateCard(title, description, action, state = 'empty') {
  return node('div', { class: 'state-card ' + state, role: state === 'loading' ? 'status' : undefined },
    icon(state === 'error' || state === 'denied' ? 'alert' : 'shield'),
    node('h3', {}, title), node('p', {}, description), action);
}

export function table(name, titles, rows, empty = 'No records found.') {
  if (!rows.length) return stateCard(empty, 'Records appear here when the organization has matching activity.');
  return node('div', { class: 'table-scroll', role: 'region', tabindex: '0', 'aria-label': name },
    node('table', {}, node('caption', { class: 'sr-only' }, name),
      node('thead', {}, node('tr', {}, titles.map(title => node('th', { scope: 'col' }, title)))),
      node('tbody', {}, rows.map(row => node('tr', {}, row.map(cell => node('td', {}, cell)))))));
}

export function field(label, control) {
  control.setAttribute('aria-label', label);
  return node('label', {}, label, control);
}
export const input = (name, props = {}) => node('input', { name, ...props });
export const select = (name, values, selected = '') => {
  const control = node('select', { name }, values.map(([value, label]) => node('option', { value }, label)));
  control.value = selected;
  return control;
};
export const actions = (...children) => node('div', { class: 'row-actions' }, children.filter(Boolean));
export const definition = entries => node('dl', { class: 'definition' }, entries.map(([title, value]) =>
  node('div', {}, node('dt', {}, title), node('dd', {}, value))));

export function chartScale(days) {
  const peak = Math.max(1, ...days.flatMap(day => [day.denials, day.reports]));
  const step = Math.max(1, Math.ceil(peak / 4));
  return { step, maximum: step * 4 };
}

export function activityChart(days) {
  if (!days.length || !days.some(day => day.denials || day.reports)) {
    return stateCard('No activity in this period', 'There are no recorded server denials or client reports for these UTC dates.');
  }
  const { step, maximum } = chartScale(days);
  const size = { left: 46, right: 626, baseline: 158, height: 128 };
  const chart = svg('svg', { viewBox: '0 0 642 188', 'aria-hidden': 'true', class: 'chart-svg' });
  const label = (text, x, y, anchor = 'middle') => {
    const item = svg('text', { x, y, 'text-anchor': anchor });
    item.textContent = text;
    chart.append(item);
  };
  for (let tick = 0; tick <= 4; tick++) {
    const y = size.baseline - tick * size.height / 4;
    chart.append(svg('line', { x1: size.left, x2: size.right, y1: y, y2: y, class: 'chart-grid' }));
    label(count(tick * step), size.left - 10, y + 4, 'end');
  }
  const spacing = (size.right - size.left) / days.length;
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  days.forEach((day, index) => {
    const x = size.left + (index + 0.5) * spacing;
    [day.denials, day.reports].forEach((value, series) => {
      const height = value / maximum * size.height;
      chart.append(svg('rect', { x: x + (series ? 2 : -18), y: size.baseline - height,
        width: 16, height, rx: 3, class: series ? 'bar-report' : 'bar-denial' }));
    });
    label(date.format(new Date(day.day + 'T00:00:00Z')), x, 181);
  });
  return node('div', { class: 'chart-box' }, node('div', { class: 'legend' },
    node('span', {}, node('i', { class: 'swatch denial', 'aria-hidden': 'true' }), 'Server denials'),
    node('span', {}, node('i', { class: 'swatch report', 'aria-hidden': 'true' }), 'Client reports')),
  chart, node('details', {}, node('summary', {}, 'View chart data'),
    table('Seven-day security activity in UTC', ['UTC date', 'Server denials', 'Client reports'],
      days.map(day => [day.day, count(day.denials), count(day.reports)]))));
}
