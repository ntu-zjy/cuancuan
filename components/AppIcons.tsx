import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return <IconBase {...props}><path d="M20 11.5a7.6 7.6 0 0 1-8 7.2 9.5 9.5 0 0 1-3.6-.7L4 20l1.2-4A7 7 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z" /><path d="M8.5 11.8h.01M12 11.8h.01M15.5 11.8h.01" /></IconBase>;
}

export function DiscoverIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="12" r="8.5" /><path d="m15.3 8.7-2 4.6-4.6 2 2-4.6 4.6-2Z" /></IconBase>;
}

export function NetworkIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="5.5" r="2.5" /><circle cx="6" cy="17.5" r="2.5" /><circle cx="18" cy="17.5" r="2.5" /><path d="m10.8 7.7-3.5 7M13.2 7.7l3.5 7M8.5 17.5h7" /></IconBase>;
}

export function RoomsIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 20v-2.2a4.3 4.3 0 0 1 4.3-4.3h2.4a4.3 4.3 0 0 1 4.3 4.3V20" /><circle cx="9.5" cy="7.5" r="3.5" /><path d="M15.5 11.5a3.2 3.2 0 0 1 4.5 3v2" /></IconBase>;
}

export function ProfileIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="12" cy="8" r="4" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></IconBase>;
}

export function ChevronDownIcon(props: IconProps) {
  return <IconBase {...props}><path d="m8 10 4 4 4-4" /></IconBase>;
}

export function RefreshIcon(props: IconProps) {
  return <IconBase {...props}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></IconBase>;
}

export function SendIcon(props: IconProps) {
  return <IconBase {...props}><path d="m4 12 16-7-5.5 14-3.2-5.8L4 12Z" /><path d="m11.3 13.2 4-4" /></IconBase>;
}

export function NewChatIcon(props: IconProps) {
  return <IconBase {...props}><path d="M13.5 5H6.8A2.8 2.8 0 0 0 4 7.8v9.4A2.8 2.8 0 0 0 6.8 20h9.4a2.8 2.8 0 0 0 2.8-2.8v-6.7" /><path d="m12 12 7.5-7.5M15.5 4.5h4v4" /></IconBase>;
}

export function PartnerIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M2.8 19a5.2 5.2 0 0 1 10.4 0M10.8 19a5.2 5.2 0 0 1 10.4 0" /></IconBase>;
}

export function PlayIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="8" cy="8" r="2.5" /><circle cx="16" cy="16" r="2.5" /><path d="m10 9.5 4 5M14.8 4.5l4.7 4.7M17.2 6.8 11 13" /></IconBase>;
}

export function LoveIcon(props: IconProps) {
  return <IconBase {...props}><path d="M20.5 9.2c0 4.7-8.5 9.3-8.5 9.3S3.5 13.9 3.5 9.2A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 8.5 1.2Z" /></IconBase>;
}

export function JobIcon(props: IconProps) {
  return <IconBase {...props}><rect x="3" y="7" width="18" height="12" rx="2.5" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12h18M10 12v2h4v-2" /></IconBase>;
}

export function CapitalIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></IconBase>;
}

export function TravelIcon(props: IconProps) {
  return <IconBase {...props}><path d="M7 7.5h10a2 2 0 0 1 2 2V19H5V9.5a2 2 0 0 1 2-2Z" /><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M8 19v1M16 19v1M9 11v4M15 11v4" /></IconBase>;
}
