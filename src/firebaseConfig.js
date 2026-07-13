export const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyDfZp-HRuybQb0v02ZXFn57b51IdGhm-2Y',
  authDomain: 'family-clean-quest.firebaseapp.com',
  projectId: 'family-clean-quest',
  storageBucket: 'family-clean-quest.firebasestorage.app',
  messagingSenderId: '172260483224',
  appId: '1:172260483224:web:55e905eb6ff42752f2b0ed',
});

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey
      && firebaseConfig.authDomain
      && firebaseConfig.projectId
      && firebaseConfig.appId,
  );
}
