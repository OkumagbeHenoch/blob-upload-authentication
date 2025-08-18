import {
  useConnectWallet,
  useCurrentAccount,
  useWallets,
} from "@mysten/dapp-kit";
import {
  isEnokiWallet,
  type EnokiWallet,
  type AuthProvider,
} from "@mysten/enoki";
import { useNavigate } from "react-router-dom";
import '../App.css'

export default function Login() {
  const currentAccount = useCurrentAccount();
  const { mutate: connect } = useConnectWallet();
  const navigate = useNavigate();

  const wallets = useWallets().filter(isEnokiWallet);
  const walletsByProvider = wallets.reduce(
    (map, wallet) => map.set(wallet.provider, wallet),
    new Map<AuthProvider, EnokiWallet>()
  );

  const googleWallet = walletsByProvider.get("google");

  console.log(currentAccount);

  if (currentAccount) {
    navigate("/");
    return null;
  }

  return (
    <div>
      <h1>Blob upload authentication</h1>
      <br />
      {googleWallet && (
        <button onClick={() => connect({ wallet: googleWallet })}>
          Sign in with Google
        </button>
      )}
    </div>
  );
}
