"use client";

import { useI18n } from "@/app/i18n-provider";

export function AuctionStatus({ closed }: { closed: boolean }) {
  const { locale } = useI18n();
  const messages = {
    en: closed ? "Auction closed. Final results remain available below." : "Bidding will open when the seller finishes Stripe setup.",
    zh: closed ? "拍卖已结束，最终结果保留在下方。" : "卖家完成 Stripe 收款设置后即可出价。",
    es: closed ? "Subasta cerrada. Los resultados finales siguen disponibles abajo." : "Podrás pujar cuando el vendedor termine de configurar Stripe.",
  };
  return <p className="auction-state-notice" role="status">{messages[locale]}</p>;
}
