/**
 * Иконки.
 *
 * Свой маленький набор вместо эмодзи: эмодзи рисуются шрифтом системы, поэтому
 * на разных телефонах выглядят по-разному, не подчиняются цвету и всегда чуть
 * мультяшные. Здесь один стиль, одна толщина линии и цвет по месту.
 */

import type { ReactElement } from "react";

type Props = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconHome = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
  </svg>
);

export const IconChart = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v8.5h8.5" />
  </svg>
);

export const IconList = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export const IconGear = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
  </svg>
);

export const IconPlus = ({ size = 22 }: Props) => (
  <svg {...base(size)} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconSearch = ({ size = 18 }: Props) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

export const IconKeypad = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="1.2" />
    <circle cx="12" cy="7" r="1.2" />
    <circle cx="17" cy="7" r="1.2" />
    <circle cx="7" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="17" cy="12" r="1.2" />
    <circle cx="12" cy="17" r="1.2" />
  </svg>
);

export const IconText = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <path d="M5 7V5h14v2M12 5v14M9.5 19h5" />
  </svg>
);

const CART = (
  <>
    <path d="M3 4h2.2l2.3 10.4h9.4L19 7H6" />
    <circle cx="9.5" cy="19" r="1.4" />
    <circle cx="16.5" cy="19" r="1.4" />
  </>
);

const CATEGORY_PATHS: Record<string, ReactElement> = {
  shop: CART,
  cafe: (
    <>
      <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
      <path d="M16 9.5h2a2.5 2.5 0 0 1 0 5h-2M7 3.5v2M11 3.5v2" />
    </>
  ),
  transport: (
    <>
      <path d="M4 16.5V11l1.8-4.2h10.4L18 11v5.5" />
      <path d="M4 13.5h14M6.5 16.5v2M15.5 16.5v2" />
      <circle cx="7.5" cy="13.5" r="0.1" />
    </>
  ),
  housing: (
    <>
      <path d="M3.5 10.5 12 4l8.5 6.5" />
      <path d="M6 9.8V20h12V9.8M10.5 20v-5h3v5" />
    </>
  ),
  connect: (
    <>
      <path d="M4 12a8 8 0 0 1 16 0" />
      <path d="M7 14a5 5 0 0 1 10 0" />
      <circle cx="12" cy="18" r="1.3" />
    </>
  ),
  health: (
    <>
      <path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7 2.6c0 5-7 9.4-7 9.4Z" />
    </>
  ),
  clothes: (
    <>
      <path d="M9 4 4.5 6.5 6 10l2-1v11h8V9l2 1 1.5-3.5L15 4a3 3 0 0 1-6 0Z" />
    </>
  ),
  fun: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="M10 9.5 15 12l-5 2.5v-5Z" />
    </>
  ),
  subs: (
    <>
      <path d="M4 9.5A8 8 0 0 1 18 7l2 2M20 14.5A8 8 0 0 1 6 17l-2-2" />
      <path d="M20 5v4h-4M4 19v-4h4" />
    </>
  ),
  other: (
    <>
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
      <path d="M4 8.5 12 13l8-4.5M12 13v7" />
    </>
  ),
};

export function CategoryIcon({ slug, size = 20 }: { slug: string | undefined; size?: number }) {
  const paths = (slug === undefined ? undefined : CATEGORY_PATHS[slug]) ?? (
    <>
      <path d="M4.5 12.5 12 5l7.5 7.5-7.5 7.5-7.5-7.5Z" />
    </>
  );

  return <svg {...base(size)}>{paths}</svg>;
}
