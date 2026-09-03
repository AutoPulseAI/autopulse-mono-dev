"use client";

import { Render } from "@measured/puck";
import "@measured/puck/puck.css";
import "@lib/puck/puck-layout.css";
import puckConfig from "@lib/puck/config";

export default function PuckPageRenderer({ data }) {
  if (!data?.content) {
    return null;
  }
  return <Render config={puckConfig} data={data} />;
}
