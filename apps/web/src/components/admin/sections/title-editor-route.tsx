"use client";

import { use } from "react";
import { TitleEditorSection } from "./title-editor";

export function TitleEditorRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TitleEditorSection key={id} id={id} />;
}
