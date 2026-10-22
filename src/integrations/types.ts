/** Состояние порта интеграции. Заглушку не выдаём за боевой режим: connected=false, mode='stub'. */
export type PortStatus = { connected: boolean; mode: 'stub' | 'live'; note?: string };
