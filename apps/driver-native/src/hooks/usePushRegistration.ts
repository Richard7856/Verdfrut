// Engancha el registro de push al ciclo de vida del (driver) layout.
//
// - Una sola vez por mount, llama a registerPushAsync.
// - Si falla, expone el resultado para que UI lo muestre (banner).
// - Si tiene éxito, escucha taps en notif y los redirige (deeplink simple
//   por ahora — sólo console.log, deeplink real entra con N5-bis).

import { useEffect, useState } from 'react';
import {
  addNotificationResponseListener,
  registerPushAsync,
  type PushRegistrationResult,
} from '@/lib/push';

export function usePushRegistration(): PushRegistrationResult | null {
  const [result, setResult] = useState<PushRegistrationResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await registerPushAsync();
      if (!cancelled) setResult(res);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = addNotificationResponseListener((data) => {
      // Tap en notif → log por ahora. N5-bis hace deeplink al chat
      // `/(driver)/stop/<reportToStopId>/chat`.
      console.info('[push] notif tapped:', data);
    });
    return unsubscribe;
  }, []);

  return result;
}
