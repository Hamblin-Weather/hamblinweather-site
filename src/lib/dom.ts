export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, text = '', className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function conditionIcon(text: string, daytime = true) {
  if (/thunder/i.test(text)) return 'storm';
  if (/snow|sleet|flurr/i.test(text)) return 'snow';
  if (/rain|shower|drizzle/i.test(text)) return 'rain';
  if (/partly|mostly sunny|mostly clear/i.test(text)) return daytime ? 'forecast' : 'moon';
  if (/cloud|fog|haze|overcast/i.test(text)) return 'cloud';
  if (/clear|sunny/i.test(text)) return daytime ? 'sun' : 'moon';
  return 'forecast';
}
