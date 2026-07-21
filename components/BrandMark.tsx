import Image from "next/image";

type Props = {
  className?: string;
  priority?: boolean;
};

export default function BrandMark({ className, priority = false }: Props) {
  return (
    <Image
      className={className}
      src="/brand/cuancuan-mark.png"
      width={64}
      height={64}
      alt=""
      aria-hidden="true"
      priority={priority}
      loading={priority ? "eager" : "lazy"}
    />
  );
}
