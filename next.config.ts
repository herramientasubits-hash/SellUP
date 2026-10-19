import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Protección ante versiones cruzadas (dueña 19-10): una página abierta antes de un deploy
  // llamaba a las acciones del servidor de la versión nueva y caía en «This page couldn't
  // load». Con el id del deploy, Next detecta el cambio y recarga la página entera.
  // Vercel expone VERCEL_DEPLOYMENT_ID al compilar; en local queda sin definir (sin efecto).
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
};

export default nextConfig;
