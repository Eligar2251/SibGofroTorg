// =========================================================
// FILE: src/components/layout/SiteLogo.tsx
// =========================================================
// Логотип «СибГофроТорг» для шапки — горизонтальная компоновка
// из фирменного SVG (public/logo.svg): знак слева, название справа.
// Инлайн-SVG: наследует шрифты страницы и не делает лишний запрос.

export function SiteLogo() {
  return (
    <svg
      className="site-logo"
      viewBox="0 0 1240 320"
      role="img"
      aria-label="СибГофроТорг"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sgtKraftGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D2A275" />
          <stop offset="100%" stopColor="#9E6F43" />
        </linearGradient>
        <linearGradient id="sgtAccentGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#B57C4A" />
          <stop offset="100%" stopColor="#704723" />
        </linearGradient>
      </defs>

      {/* Знак: стилизованная коробка со стрелкой/волной.
          Поднят на ~14 ед. — оптический центр массы (тяжёлая
          нижняя вершина) совпадает с центром текста */}
      <g transform="translate(-95, -54)">
        <polygon
          points="250,110 130,170 130,300 250,240"
          fill="url(#sgtAccentGrad)"
        />
        <polygon
          points="250,240 370,300 370,170 250,110"
          fill="url(#sgtKraftGrad)"
        />
        <path
          d="M 160,200
             C 200,160 220,260 250,210
             C 280,160 310,200 340,170
             L 340,195
             C 310,225 280,185 250,235
             C 220,285 190,185 160,225 Z"
          fill="#FFFFFF"
          opacity="0.9"
        />
        <polygon
          points="250,110 370,170 310,140 190,80"
          fill="#E6BA94"
          opacity="0.7"
        />
      </g>

      {/* Название компании */}
      <text
        x="308"
        y="196"
        fontFamily="'Montserrat', 'Oswald', 'Arial Black', sans-serif"
        fontSize="86"
        fontWeight="900"
        fill="#0a0a0a"
        letterSpacing="3"
      >
        СИБГОФРОТОРГ
      </text>

      {/* Декоративная линия */}
      <line
        x1="310"
        y1="222"
        x2="1120"
        y2="222"
        stroke="#D2A275"
        strokeWidth="3"
        strokeDasharray="8 5"
      />
    </svg>
  );
}
