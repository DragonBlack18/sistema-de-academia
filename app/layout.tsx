import type { Metadata } from 'next';
import './fonts.css';
import './globals.css';
import '@/components/modules/modules.css';
export const metadata:Metadata={title:'Vitality Gym — Gestão em movimento',description:'Alunos, treinos, financeiro e resultados. Toda a sua academia em um único lugar.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>;}
