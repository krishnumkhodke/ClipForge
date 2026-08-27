"use client";

import dynamic from "next/dynamic";

const TrueForgeChat = dynamic(
  () => import("./trueforge-chat").then((mod) => mod.TrueForgeChat),
  { ssr: false },
);

export default function Home() {
  return <TrueForgeChat />;
}
