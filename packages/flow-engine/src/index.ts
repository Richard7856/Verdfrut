// Máquina de transiciones para los flujos del driver app.
// Centraliza la lógica de "¿cuál es el siguiente paso?" para que la UI no la duplique.
//
// El estado se persiste en delivery_reports.current_step (DB) y en URL (?step=).
// Ver packages/types/src/flow/steps.ts para los tipos.

export * from './transitions';
