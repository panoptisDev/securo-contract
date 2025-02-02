// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./BNIMinter.sol";
import "./priceOracle/IPriceOracle.sol";
import "./constant/AvaxConstantTest.sol";

contract BNIMinterTest is BNIMinter {

    /// @return the price of USDT in USD.
    function getUSDTPriceInUSD() public override view returns(uint, uint8) {
        return priceOracle.getAssetPrice(AvaxConstantTest.USDT);
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        priceOracle = IPriceOracle(_priceOracle);
    }
}
