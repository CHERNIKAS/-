import { guessIcon } from "@costnote/core";
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

export const IconCalendar = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 9.5h17M8 3v3.4M16 3v3.4" />
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
  sport: (
    <>
      <path d="M6.5 8v8M17.5 8v8M4 10v4M20 10v4M6.5 12h11" />
    </>
  ),
  kids: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M7 20c0-3 2.2-5 5-5s5 2 5 5" />
      <path d="M8.5 5.5 7 3.5M15.5 5.5 17 3.5" />
    </>
  ),
  pets: (
    <>
      <circle cx="8" cy="9" r="1.6" />
      <circle cx="12" cy="7.5" r="1.6" />
      <circle cx="16" cy="9" r="1.6" />
      <path d="M12 12c-2.5 0-4.5 2-4.5 4.2 0 1.6 1.3 2.6 2.9 2.2l1.6-.4 1.6.4c1.6.4 2.9-.6 2.9-2.2C16.5 14 14.5 12 12 12Z" />
    </>
  ),
  gift: (
    <>
      <rect x="4" y="9.5" width="16" height="10" rx="2" />
      <path d="M4 13h16M12 9.5V19.5" />
      <path d="M12 9.5C10 9.5 8 8.7 8 7a2 2 0 0 1 4 0c0-1.4 1-2 2-2a2 2 0 0 1 0 4c-1 0-2 .5-2 .5Z" />
    </>
  ),
  study: (
    <>
      <path d="M3.5 9.5 12 5.5l8.5 4-8.5 4-8.5-4Z" />
      <path d="M7 11.8V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.2" />
    </>
  ),
  beauty: (
    <>
      <path d="M9 4.5h6l-1 7a2 2 0 0 1-4 0l-1-7Z" />
      <path d="M12 13.5v6M9.5 19.5h5" />
    </>
  ),
  repair: (
    <>
      <path d="M14.5 4.5a4.5 4.5 0 0 0-5.9 5.9l-4.1 4.1a2 2 0 1 0 2.8 2.8l4.1-4.1a4.5 4.5 0 0 0 5.9-5.9l-2.6 2.6-2.2-2.2 2-3.2Z" />
    </>
  ),
  car: (
    <>
      <path d="M4 16v-4l1.8-4h10.4L18 12v4" />
      <path d="M4 13.5h14" />
      <circle cx="7.5" cy="16.5" r="1.4" />
      <circle cx="16.5" cy="16.5" r="1.4" />
    </>
  ),
  travel: (
    <>
      <path d="M3 13.5 20 6l-3.5 8.5L12 15l-1.5 4-1.5-4.5L3 13.5Z" />
    </>
  ),
  tax: (
    <>
      <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4v-17Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h9a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 3v-18Z" />
      <path d="M5 19.5a3 3 0 0 1 3-3h9" />
    </>
  ),
  tech: (
    <>
      <rect x="3.5" y="5.5" width="17" height="11" rx="2" />
      <path d="M2 19.5h20" />
    </>
  ),
  smoke: (
    <>
      <rect x="3.5" y="13" width="13" height="4" rx="1" />
      <path d="M18.5 13v4M21 13v4M13 13V9a2.5 2.5 0 0 1 2.5-2.5" />
    </>
  ),
  bar: (
    <>
      <path d="M7 4.5h10l-5 6-5-6Z" />
      <path d="M12 10.5v8M9 18.5h6" />
    </>
  ),
  // Доход — не категория, но в списке ему нужен свой знак: стрелка вниз, в
  // кошелёк, против стрелки расхода.
  income: (
    <>
      <path d="M12 4.5v11M8 12l4 4 4-4" />
      <path d="M4.5 18.5h15" />
    </>
  ),
};

/**
 * Значок категории.
 *
 * У встроенных категорий он привязан к слагу, у заведённых человеком слаг
 * случайный — там значок подбирается по названию той же таблицей, что и эмодзи
 * в чате. Иначе все новые категории выглядели бы одинаково.
 */
export function CategoryIcon({
  slug,
  title,
  size = 20,
}: {
  slug: string | undefined;
  title?: string;
  size?: number;
}) {
  const key =
    slug !== undefined && CATEGORY_PATHS[slug] !== undefined
      ? slug
      : title === undefined
        ? slug
        : guessIcon(title).icon;

  const paths = (key === undefined ? undefined : CATEGORY_PATHS[key]) ?? (
    <>
      <path d="M4.5 12.5 12 5l7.5 7.5-7.5 7.5-7.5-7.5Z" />
    </>
  );

  return <svg {...base(size)}>{paths}</svg>;
}
