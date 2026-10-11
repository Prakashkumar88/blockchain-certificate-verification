import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletProvider } from './contexts/WalletContext';
import { AuthProvider } from './contexts/AuthContext';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';

// Pages
import Verify from './pages/Verify';
import Dashboard from './pages/Dashboard';
import Issue from './pages/Issue';
import BatchIssue from './pages/BatchIssue';

function App() {
  return (
    <WalletProvider>
      <AuthProvider>
        <BrowserRouter>
          <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 selection:bg-teal-100 selection:text-teal-900">
            <Navbar />
            <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
              <Routes>
                <Route path="/" element={<Verify />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/issue" element={<Issue />} />
                <Route path="/issue/batch" element={<BatchIssue />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </WalletProvider>
  );
}

export default App;
