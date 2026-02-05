"use client";
import dynamic from "next/dynamic";

const Renderer = dynamic(() => import("./components/Renderer"), {
  ssr: false,
  // Optional: Add a loading state so the screen isn't blank
  loading: () => <div className="h-screen w-screen bg-amber-800" />,
});

export default function Home() {
  return (
    <main>
      <Renderer />
    </main>
  );
}
