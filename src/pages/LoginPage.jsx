// src/pages/LoginPage.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase/firebaseConfig';
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import styles from '../styles/LoginPage.module.css';
import ForgotPasswordModal from '../components/modals/ForgotPasswordModal';
import Navbar_register from '../components/layout/NavbarRegister';

// Renders the login page for user authentication.
const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [messageConfig, setMessageConfig] = useState({ text: '', type: 'error', visible: false });
  const [showPassword, setShowPassword] = useState(false);
  const [isModalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();

  // NOTE: Redirection for already logged-in users is now handled centrally in App.jsx for better security and consistency.

  // Displays a message banner.
  const displayMessage = (text, type = 'error', duration = 4000) => {
    setMessageConfig({ text, type, visible: true });
    setTimeout(() => setMessageConfig((prev) => ({ ...prev, visible: false })), duration);
  };

  // Handles the user login process using Firebase's secure authentication and persistence.
  const handleLogin = async (event) => {
    event.preventDefault();
    // SECURITY: Basic input validation to prevent empty submissions.
    if (!email || !password) {
      displayMessage('Please enter both email and password.');
      return;
    }
    setIsLoading(true);

    try {
      // Set session persistence based on user's choice. This is more secure than manual token management.
      // This must be called BEFORE signInWithEmailAndPassword.
      await setPersistence(auth, keepLoggedIn ? browserLocalPersistence : browserSessionPersistence);
      
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      console.log(`User logged in: ${user.email}. Persistence set to: ${keepLoggedIn ? 'local' : 'session'}`);

      // No need to manually manage auth data in localStorage/sessionStorage. Firebase handles it securely.
      
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Login failed:', error.code, error.message);
      let errorMessage = 'Login failed. Please check your credentials.';
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        errorMessage = 'Invalid email or password.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Access to this account has been temporarily disabled due to many failed login attempts. You can immediately restore it by resetting your password or you can try again later.';
      }
      displayMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className={`${styles.messageDiv} ${messageConfig.visible ? styles.show : ''} ${styles[messageConfig.type]}`}>
        {messageConfig.text}
      </div>
      <div className={styles.pageWrapper}>
        <div className={styles.loginContainer}>
          <img src="/logo.webp" alt="PEMS Logo" className={styles.enhancedLogo} />
          <h1>PEMS<span style={{ color: '#a2e089' }}>.</span></h1>
          <p>Poultry Environment Monitoring System</p>

          <form onSubmit={handleLogin} noValidate>
            <div className="input-group mb-3">
              <span className={`input-group-text ${styles.iconSpan}`}>
                <i className="bi bi-envelope-fill"></i>
              </span>
              <input
                type="email"
                className={`form-control ${styles.formControl}`}
                placeholder="EMAIL"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                autoComplete="email"
              />
            </div>

            <div className="input-group mb-3">
              <span className={`input-group-text ${styles.iconSpan}`}>
                <i className="bi bi-lock-fill"></i>
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                className={`form-control ${styles.formControl}`}
                placeholder="PASSWORD"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                autoComplete="current-password"
              />
              <span className={`input-group-text ${styles.passwordToggleIcon}`} onClick={() => setShowPassword(!showPassword)}>
                <i className={`bi ${showPassword ? 'bi-eye-slash-fill' : 'bi-eye-fill'}`}></i>
              </span>
            </div>

            <div className={styles.loginOptions}>
              <div className={styles.checkboxContainer}>
                <input
                  type="checkbox"
                  id="keepLoggedIn"
                  checked={keepLoggedIn}
                  onChange={(e) => setKeepLoggedIn(e.target.checked)}
                  disabled={isLoading}
                />
                <label htmlFor="keepLoggedIn">Keep me logged in</label>
              </div>
              <button
                type="button"
                className={`${styles.forgotPassword} ${isLoading ? styles.disabledLink : ''}`}
                onClick={() => !isLoading && setModalOpen(true)}
                disabled={isLoading}
              >
                Forgot Password?
              </button>
            </div>

            <button type="submit" className={`btn ${styles.btnLogin}`} disabled={isLoading}>
              {isLoading ? (
                <>
                  <span className={styles.spinner} /> Logging In...
                </>
              ) : (
                'LOGIN'
              )}
            </button>
          </form>
        </div>
      </div>
      <ForgotPasswordModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};

export default LoginPage;