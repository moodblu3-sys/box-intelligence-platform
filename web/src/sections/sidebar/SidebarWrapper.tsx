"use client";

import React from "react";
import { SidebarLayouts } from "@opal/layouts";
import { useShowLogoWhenFolded } from "@/lib/sidebar/hooks";
import { PRODUCT_NAME } from "@/lib/branding";

/**
 * Renders the app-branded logo for use as the `logo` prop on sidebar primitives.
 * Exported so other sidebar entry points (e.g. AdminSidebar) can reuse it.
 */
export function renderAppLogo(folded: boolean | undefined): React.ReactNode {
  return (
    <div className="px-1 flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black text-base font-semibold leading-none text-white">
        K
      </span>
      {!folded && (
        <span className="text-[28px] leading-none font-semibold tracking-normal">
          {PRODUCT_NAME}
        </span>
      )}
    </div>
  );
}

export interface SidebarWrapperProps {
  foldable?: boolean;
  children?: React.ReactNode;
}

/**
 * App-specific sidebar wrapper. Thin shell around `SidebarLayouts.Root`
 * that injects the enterprise-aware logo and show/hide rules.
 */
export default function SidebarWrapper({
  foldable = false,
  children,
}: SidebarWrapperProps) {
  const showLogoWhenFolded = useShowLogoWhenFolded();

  return (
    <SidebarLayouts.Root foldable={foldable}>
      <SidebarLayouts.Header
        logo={renderAppLogo}
        showLogoWhenFolded={showLogoWhenFolded}
      />
      {children}
    </SidebarLayouts.Root>
  );
}
