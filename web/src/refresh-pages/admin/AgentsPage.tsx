"use client";

import { SvgOnyxOctagon, SvgPlus } from "@opal/icons";
import { Button } from "@opal/components";
import { SettingsLayouts } from "@opal/layouts";
import Link from "next/link";

import AgentsTable from "./AgentsPage/AgentsTable";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  return (
    <SettingsLayouts.Root>
      <SettingsLayouts.Header
        title="回答エージェント"
        description="用途に合わせて回答方針と参照ナレッジを管理します。"
        icon={SvgOnyxOctagon}
        rightChildren={
          <Button href="/app/agents/create?admin=true" icon={SvgPlus}>
            新しい回答エージェント
          </Button>
        }
      />
      <SettingsLayouts.Body>
        <AgentsTable />
      </SettingsLayouts.Body>
    </SettingsLayouts.Root>
  );
}
