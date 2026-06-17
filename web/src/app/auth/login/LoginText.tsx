"use client";

import React, { useContext } from "react";
import { SettingsContext } from "@/providers/SettingsProvider";
import Text from "@/refresh-components/texts/Text";
import { productDisplayName, PRODUCT_TAGLINE } from "@/lib/branding";

export default function LoginText() {
  const settings = useContext(SettingsContext);
  return (
    <div className="w-full flex flex-col ">
      <Text as="p" headingH2 text05>
        Welcome to{" "}
        {productDisplayName(settings?.enterpriseSettings?.application_name)}
      </Text>
      <Text as="p" text03 mainUiMuted>
        {PRODUCT_TAGLINE}
      </Text>
    </div>
  );
}
