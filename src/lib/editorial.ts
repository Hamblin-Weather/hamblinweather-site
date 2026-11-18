export function editorialDate(date: string, time?: string) {
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago',
  }).format(new Date(date + 'T12:00:00Z'));
  if (!time) return day;
  // The optional clock value is entered in Central Time. Format its wall
  // time without applying the reader's browser offset.
  const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(date + 'T' + time + ':00Z'));
  return day + ' · ' + clock + ' CT';
}

export function editorialTimestamp(data: { published: string; publishedTime?: string }) {
  return data.published + (data.publishedTime ? 'T' + data.publishedTime : '');
}
