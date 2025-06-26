const report = (data, wallet = {}) => {
    const temp = data.reduce((acc, el) => {
        if (el.type === 'BUY') {
            acc.out += el.out_usd;
        } else if (el.type === 'SELL') {
            acc.in += el.in_usd;
        }

        acc.BNB += el.fee_bnb;
        acc.BNB_USD += el.fee_usd;

        return acc;
    }, {
        out: 0,
        in: 0,
        BNB: 0,
        BNB_USD: 0
    });

    return {
        name: wallet.name,
        address: wallet.address,
        total_USD: temp.out.toFixed(2),
        spent_USD: (temp.out > temp.in) ? (temp.out - temp.in).toFixed(2) : 0,
        received_USD: (temp.out > temp.in) ? 0 : (temp.in - temp.out).toFixed(2),
        BNB: temp.BNB,
        BNB_USD: temp.BNB_USD.toFixed(2)
    };
};

module.exports = {
    report
}