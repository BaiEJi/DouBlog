const I = (children, size = 16, sw = 1.5) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

export const Icon = {
  today: I(<><rect x="3" y="3" width="6.2" height="6.2" rx="1.5" /><rect x="10.8" y="3" width="6.2" height="6.2" rx="1.5" /><rect x="10.8" y="10.8" width="6.2" height="6.2" rx="1.5" /><rect x="3" y="10.8" width="6.2" height="6.2" rx="1.5" /></>),
  inbox: I(<><path d="M3 10.5 5 4h10l2 6.5V15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15v-4.5z" /><path d="M3 10.5h4l1 2h4l1-2h4" /></>),
  calendar: I(<><rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /></>),
  review: I(<><rect x="4" y="3" width="12" height="14" rx="2" /><path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" /></>),
  stats: I(<><path d="M4.5 16.5v-6M10 16.5v-11M15.5 16.5v-8M2.5 16.5h15" /></>),
  life: I(<path d="M10 16.5s-6-3.6-6-7.8A3.3 3.3 0 0 1 10 6.6a3.3 3.3 0 0 1 6 2.1c0 4.2-6 7.8-6 7.8z" />),
  settings: I(<><circle cx="10" cy="10" r="2.2" /><path d="M10 2.8v2.4M10 14.8v2.4M2.8 10h2.4M14.8 10h2.4M4.9 4.9l1.7 1.7M13.4 13.4l1.7 1.7M15.1 4.9l-1.7 1.7M6.6 13.4l-1.7 1.7" /></>),
  plus: I(<path d="M10 4.5v11M4.5 10h11" />),
  chevL: I(<path d="M12 4l-5 6 5 6" />),
  chevR: I(<path d="M8 4l5 6-5 6" />),
  dots: I(<><circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" /></>, 15),
  check: I(<path d="M4 10.5l4 4 8-9" />),
  trash: I(<><path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11" /></>, 13),
  edit: I(<path d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z" />, 13),
  refresh: I(<><path d="M16 8A6.5 6.5 0 1 0 16 12.5" /><path d="M16 3.5V8h-4.5" /></>, 14),
  clock: I(<><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.8" /></>, 13),
  fire: I(<path d="M10 2.5c.4 2.2 3.5 3.6 3.5 7a3.5 3.5 0 1 1-7 0c0-1.5.8-2.8 1.9-3.8.2 1.2.9 2 1.6 2.5-.1-1.9-.4-4 0-5.7z" />, 14),
  migrate: I(<><path d="M4.2 10a6 6 0 0 1 10.2-4.3M15.8 10a6 6 0 0 1-10.2 4.3" /><path d="M14.6 2.6v3.2h-3.2M5.4 17.4v-3.2h3.2" /></>, 14),
  warning: I(<><path d="M10 3 1.8 17h16.4L10 3z" /><path d="M10 9v4M10 15.6v.1" /></>, 14),
  checkCircle: I(<><circle cx="10" cy="10" r="7" /><path d="M6.5 10.2l2.4 2.4 4.6-5.2" /></>, 14),
  sun: I(<><circle cx="10" cy="10" r="3.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>),
  moon: I(<path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5 6.8 6.8 0 1 0 15.5 12.6Z" />),
  back: I(<path d="M15 5l-7 7 7 7" />, 15),
}
