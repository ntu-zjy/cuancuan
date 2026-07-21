import Image from "next/image";
import Link from "next/link";
import { CHANNEL_LIST } from "@/lib/channels";
import type { Channel } from "@/lib/types";
import BrandMark from "./BrandMark";

const howItWorks = [
  {
    title: "说说你的想法",
    description: "告诉攒攒想做什么、什么时候、在哪里。",
  },
  {
    title: "看看合适的人",
    description: "看清推荐理由，再决定要不要认识。",
  },
  {
    title: "约好下一步",
    description: "双方同意后，再聊天、见面或一起做事。",
  },
];

const channelImages: Record<Channel, { src: string; alt: string }> = {
  founder: {
    src: "/landing/channel-founder.webp",
    alt: "两个人围着电脑和产品原型讨论，并为新伙伴留出座位",
  },
  play: {
    src: "/landing/channel-play.webp",
    alt: "带着球拍、展览票和咖啡的人一起出门活动",
  },
  love: {
    src: "/landing/channel-love.webp",
    alt: "两个人在咖啡馆轻松约会",
  },
  jobs: {
    src: "/landing/channel-jobs.webp",
    alt: "求职者和招聘方围绕作品集进行交流",
  },
  capital: {
    src: "/landing/channel-capital.webp",
    alt: "创业者与投资人围绕产品原型和项目进展进行交流",
  },
  travel: {
    src: "/landing/channel-travel.webp",
    alt: "三位旅友带着地图、背包和行李，在出发前一起确认旅行方向",
  },
};

const channelSummaries: Record<Channel, string> = {
  founder: "找合伙人，或先试一次合作",
  play: "找玩伴，一起运动、看展或吃饭",
  love: "认真认识一个愿意见面的人",
  jobs: "找到合适的工作或候选人",
  capital: "让好项目和合适的资金先聊起来",
  travel: "找日期、预算和旅行节奏合得来的同行者",
};

export default function ChannelLanding() {
  return (
    <main className="channel-landing">
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="攒攒首页">
          <BrandMark priority />
          <span>攒攒</span>
        </Link>
        <nav className="landing-nav-links" aria-label="首页导航">
          <a href="#scenes">能做什么</a>
          <a href="#how">怎么开始</a>
        </nav>
        <Link className="landing-nav-cta" href="/chat">开始使用</Link>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <h1 id="landing-title">
            <span>想找人一起做件事？</span>
            <span>交给攒攒。</span>
          </h1>
          <p className="landing-lead">
            说清你想找谁、什么时候、一起做什么。攒攒帮你找到合适的人，再安排下一步。
          </p>
          <div className="landing-actions">
            <Link className="landing-primary-action" href="/chat">开始和攒攒聊 <span>→</span></Link>
          </div>
        </div>
        <div className="landing-product-showcase" aria-label="攒攒产品概览">
          <Image
            className="landing-hero-image"
            src="/landing/cuancuan-hero.webp"
            alt="不同需求的人来到同一张桌前，准备认识合适的新伙伴"
            width={1440}
            height={960}
            priority
          />
        </div>
      </section>

      <section className="landing-channels" id="scenes" aria-labelledby="channels-title">
        <header>
          <h2 id="channels-title">攒攒可以帮你找这些人</h2>
        </header>

        <div className="landing-channel-list">
          {CHANNEL_LIST.map((channel) => (
            <article className="landing-channel-row" key={channel.id}>
              <div className="landing-channel-main">
                <h3>{channel.name}</h3>
                <p>{channelSummaries[channel.id]}</p>
              </div>
              <div className="landing-channel-visual">
                <Image
                  src={channelImages[channel.id].src}
                  alt={channelImages[channel.id].alt}
                  width={760}
                  height={507}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-how" id="how" aria-labelledby="how-title">
        <header>
          <h2 id="how-title">三步开始</h2>
        </header>
        <div className="landing-how-steps">
          {howItWorks.map((step, index) => (
            <article key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-final-cta" aria-label="开始使用攒攒">
        <h2>下一次想找人，先问问攒攒。</h2>
        <p>不用选入口，也不用填一长串资料。从一句话开始就好。</p>
        <Link className="landing-primary-action" href="/chat">开始使用 <span>→</span></Link>
      </section>

      <footer className="landing-footer">
        <div>
          <BrandMark />
          <span>攒攒</span>
        </div>
        <p>帮你找到合适的人，一起做一件具体的事。</p>
      </footer>
    </main>
  );
}
