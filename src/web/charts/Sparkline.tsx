import { extent, sparkPath } from "../logic";

const width = 120;
const height = 32;

// Small trend line with no axes. The hover title carries the min and max.
export function Sparkline({
  values,
  label,
  format,
  color,
}: {
  values: number[];
  label: string;
  format: (value: number) => string;
  color: string;
}) {
  if (values.length < 2) return null;
  const { min, max } = extent(values);
  const text = `${label}: min ${format(min)}, max ${format(max)} per bucket`;
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={text}
    >
      <title>{text}</title>
      <rect width={width} height={height} fill="transparent" />
      <path d={sparkPath(values, width, height)} style={{ stroke: color }} />
    </svg>
  );
}
