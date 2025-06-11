import time
import requests
__version__ = '21'
from web3 import Web3
from web3.middleware import geth_poa_middleware
from web3.exceptions import BlockNotFound
__version__ = '21'
from datetime import datetime
__version__ = '21'
import config

# Minimal ERC20 ABI for decimals
ERC20_ABI = [{
    "constant": True, "inputs": [], "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "stateMutability": "view", "type": "function"
}]

def fetch_bnb_price():
    try:
        res = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids":"binancecoin","vs_currencies":"usd"},
            timeout=10
        ).json()
        return res.get("binancecoin", {}).get("usd", 0.0)
    except:
        return 0.0

def load_wallets(path):
    wallets = {}
    with open(path) as f:
        for line in f:
            line=line.strip()
            if not line or line.startswith("#"): continue
            addr,name=line.split(";",1)
            wallets[Web3.to_checksum_address(addr.strip())] = name.strip()
    return wallets

def parse_amount(data):
    if isinstance(data, bytes):
        return int.from_bytes(data, 'big')
    return int(data, 16)

def fmt_usdc(x):
    s = f"{x:.2f}".rstrip('0').rstrip('.')
    return s

def send_telegram(msg):
    if config.TELEGRAM_BOT_TOKEN and config.TELEGRAM_CHAT_ID:
        url = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {"chat_id": config.TELEGRAM_CHAT_ID, "text": msg}
        try:
            requests.post(url, data=payload, timeout=5)
        except:
            pass

def main():
    # Fetch BNB price once
    bnb_price = fetch_bnb_price()

    w3 = Web3(Web3.HTTPProvider(config.RPC_URL))
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    if not w3.is_connected():
        print("Error: unable to connect to RPC")
        return

    # Get USDC decimals
    usdc_contract = w3.eth.contract(address=config.USDC_CONTRACT, abi=ERC20_ABI)
    try:
        usdc_decimals = usdc_contract.functions.decimals().call()
    except:
        usdc_decimals = 18

    # Initialize state
    state = {
        addr: {
            "name": name,
            "cycle": 0,
            "wait_buy": True,
            "first": None,
            "last": None,
            "total_usdc": 0.0,
            "bnb_fees": 0.0,
                "first_ts": None,
                "last_ts": None,
                "total_lost": 0.0,
                "last_buy_amt": 0.0
        }
        for addr,name in load_wallets(config.WALLETS_FILE).items()
    }

    last_block = w3.eth.block_number
    print("Start working")

    block_cache = {}

    while True:
        try:
            current = w3.eth.block_number
            if current <= last_block:
                time.sleep(0.75)
                continue

            logs = w3.eth.get_logs({
                "fromBlock": last_block + 1,
                "toBlock": current,
                "address": config.ZKJ_CONTRACT,
                "topics": [config.TRANSFER_SIG]
            })

            for lg in logs:
                tx_hash = lg["transactionHash"]
                bn_raw = lg["blockNumber"]
                # Convert block number robustly
                if isinstance(bn_raw, (str, bytes)):
                    bn = Web3.to_int(hexstr=bn_raw) if isinstance(bn_raw, str) else int.from_bytes(bn_raw, 'big')
                else:
                    bn = int(bn_raw)
                # Cache timestamp
                if bn not in block_cache:
                    try:
                        # Ensure block number is int (handle hex strings)
                        block_id = int(bn, 16) if isinstance(bn, str) and bn.startswith('0x') else int(bn)
                        # Retry fetching block with retries
                        for attempt in range(config.max_retries):
                            try:
                                ts = w3.eth.get_block(block_id).timestamp
                                block_cache[bn] = ts
                                break
                            except BlockNotFound:
                                print(f"Info: block {block_id} not yet available, retry {attempt+1}/{config.max_retries}")
                                time.sleep(config.sleep_interval)
                        else:
                            print(f"Warning: Failed to fetch block {block_id} after {config.max_retries} attempts, skipping")
                            continue
                    except Exception as e:
                        if 'not yet mined' in str(e) or 'not found' in str(e):
                            # Skip this block for now and wait for it
                            time.sleep(config.sleep_interval)
                            break
                        print(f"Warning: could not fetch block {bn}: {e}")
                        continue
                ts = datetime.fromtimestamp(block_cache[bn]).strftime("%H:%M:%S")

                frm = "0x" + lg["topics"][1].hex()[-40:]
                to = "0x" + lg["topics"][2].hex()[-40:]
                wallet = None; is_buy = False
                for addr,info in state.items():
                    if info["wait_buy"] and to.lower()==addr.lower():
                        wallet=addr; is_buy=True; break
                    if not info["wait_buy"] and frm.lower()==addr.lower():
                        wallet=addr; is_buy=False; break
                if not wallet:
                    continue

                info = state[wallet]
                info["first_ts"] = info["first_ts"] or block_cache[bn]
                info["last_ts"] = block_cache[bn]
                name = info["name"]

                receipt = w3.eth.get_transaction_receipt(tx_hash)
                gp = receipt.get("effectiveGasPrice", 0)
                fee = receipt.gasUsed * gp / 1e18
                info["bnb_fees"] += fee

                usdc_amt = 0.0
                for log in receipt.logs:
                    if log.address.lower()!=config.USDC_CONTRACT.lower(): continue
                    if not log.topics or log.topics[0].hex()!=config.TRANSFER_SIG: continue
                    fu = "0x" + log.topics[1].hex()[-40:]
                    tu = "0x" + log.topics[2].hex()[-40:]
                    val = parse_amount(log.data) / (10 ** usdc_decimals)
                    if is_buy and fu.lower()==wallet.lower():
                        usdc_amt = val
                        info["total_usdc"] += val
                        if info["first"] is None:
                            info["first"] = val
                        break
                    if not is_buy and tu.lower()==wallet.lower():
                        usdc_amt = val
                        # Set last only on final sell
                        if info["cycle"] == config.CYCLE_LIMIT:
                            info["last"] = val
                        break

                idx = info["cycle"]+1 if is_buy else info["cycle"]
                action = (f"Swap {fmt_usdc(usdc_amt)} USDC for ZKJ"
                          if is_buy else
                          f"Swap ZKJ for {fmt_usdc(usdc_amt)} USDC")
                # calculate loss or record buy amount
                if not is_buy:
                    lost = info["last_buy_amt"] - usdc_amt
                    info["total_lost"] += lost
                    lost_str = f" | {lost:.2f}$ lost"
                else:
                    lost_str = ""
                    info["last_buy_amt"] = usdc_amt
                msg = f"{name} [{idx}/{config.CYCLE_LIMIT}] {action} | {ts}{lost_str}"
                print(msg)
                with open(config.LOG_FILE, "a") as lf:
                    lf.write(msg + "\n")

                # Update state
                if is_buy:
                    info["cycle"] += 1
                    info["wait_buy"] = False
                else:
                    info["wait_buy"] = True
                    if info["cycle"] >= config.CYCLE_LIMIT:
                        total = fmt_usdc(info["total_usdc"])
                        fee_usd = fmt_usdc(info["bnb_fees"] * bnb_price)
                        # compute duration
                        first_ts = info["first_ts"]
                        last_ts = info["last_ts"]
                        if first_ts is not None and last_ts is not None:
                            dur_secs = last_ts - first_ts
                            mins, secs = divmod(int(dur_secs), 60)
                            dur_str = f", {mins} m {secs} s"
                        else:
                            dur_str = ""
                        lost_total = fmt_usdc(info["total_lost"])
                        done = (f"{name} | Wallet done, total {total} USDC, spent {lost_total} USDC, {fee_usd}$ in BNB{dur_str}")
                        print(done)
                        with open(config.LOG_FILE, "a") as lf:
                            lf.write(done + "\n")
                        send_telegram(done)

            last_block = current
            time.sleep(0.5 if logs else 1.0)

        except Exception as e:
            if 'not yet mined' in str(e) or 'not found' in str(e):
                # Skip this block for now and wait for it
                time.sleep(config.sleep_interval)
                break
            print("Error:", e)
            time.sleep(2)

if __name__=="__main__":
    main()
