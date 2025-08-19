import { useCurrentAccount } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { Link } from "react-router-dom";
import LogoutButton from "../components/Logout";
import WalrusUploaderFlow from "../components/WalrusUpload";
import {ConnectButton} from "@mysten/dapp-kit";
// import TransferSUI from "../components/Send";
import "../App.css";

export default function Home() {
  const currentAccount = useCurrentAccount();

  if (!currentAccount) {
    return (
      <div>
        <h1>You are not logged in.</h1>
        <Link to="/login">Go to Login</Link>
      </div>
    );
  }

  // Build transaction
  const tx = new Transaction();
  tx.moveCall({
    target: "",
    arguments: [],
  });
return (
  <div >
    <h1 className="">
      Welcome,<br />
      <span className="">{currentAccount.address}</span>
      <ConnectButton/>
    </h1>
    <WalrusUploaderFlow/>
    <LogoutButton />
  </div>
);

}
