import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Doc Analyzer | inference-relay',
  description: 'Two-phase document analysis workstation powered by inference-relay',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{
        margin: 0,
        padding: 0,
        backgroundColor: '#09090B',
        color: '#fafafa',
        fontFamily: '"Geist Mono", monospace',
        minHeight: '100vh',
      }}>
        {children}
      </body>
    </html>
  );
}
