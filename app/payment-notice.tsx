"use client";

import { useI18n } from "@/app/i18n-provider";
import type { CheckoutReturnState } from "@/app/use-checkout-return";

const messages = {
  en: {
    confirming: "Confirming your payment…",
    accepted: "Payment confirmed. Your bid is live; the latest winner is shown below.",
    refunded: "Your bid no longer leads. Your deposit has been refunded.",
    refund_pending: "Your bid no longer leads. Your deposit refund is still being processed.",
    cancelled: "Checkout cancelled. No new bid was placed.",
    expired: "This Checkout expired. Start a new bid to continue.",
    failed: "We could not confirm your bid. Check the payment status again before making another payment.",
  },
  zh: {
    confirming: "正在确认付款…",
    accepted: "付款已确认，出价已记录。下方展示当前最高出价者。",
    refunded: "你的出价未能保持领先，订金已退还。",
    refund_pending: "你的出价未能保持领先，订金退款正在处理中。",
    cancelled: "已取消付款，没有提交新的出价。",
    expired: "此付款链接已过期，请重新出价。",
    failed: "暂时无法确认出价。再次付款前，请重新检查支付状态。",
  },
  es: {
    confirming: "Confirmando tu pago…",
    accepted: "Pago confirmado. Tu puja está registrada; abajo se muestra el líder actual.",
    refunded: "Tu puja ya no lidera. Se ha reembolsado tu depósito.",
    refund_pending: "Tu puja ya no lidera. El reembolso de tu depósito sigue en proceso.",
    cancelled: "Pago cancelado. No se registró ninguna puja nueva.",
    expired: "Este pago ha caducado. Inicia una nueva puja.",
    failed: "No pudimos confirmar tu puja. Vuelve a comprobar el estado del pago antes de pagar otra vez.",
  },
};

export function PaymentNotice({ state, retry }: { state: CheckoutReturnState; retry: () => void }) {
  const { locale } = useI18n();
  if (state === "idle") return null;
  return <div className={`payment-notice payment-notice--${state}`} role="status" aria-live="polite">
    <p>{messages[locale][state]}</p>
    {(state === "failed" || state === "refund_pending") && <button type="button" onClick={retry}>{locale === "zh" ? "重新检查支付状态" : locale === "es" ? "Volver a comprobar el pago" : "Check payment status again"}</button>}
  </div>;
}
