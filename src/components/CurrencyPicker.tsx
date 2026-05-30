import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { Select } from "./ui";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<"select">, "children">;

export function CurrencyPicker(props: Props) {
  return (
    <Select {...props}>
      {SUPPORTED_CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.name}
        </option>
      ))}
    </Select>
  );
}
