//SPDX-License-Identifier: MIT
pragma solidity  0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../../../libs/Const.sol";
import "../../../libs/Token.sol";
import "../BasicXChainAdapter.sol";
import "./AnyswapMap.sol";
import "./IAnycallV6Proxy.sol";
import "./IAnyswapV6Router.sol";

contract MultichainXChainAdapter is BasicXChainAdapter {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IAnycallV6Proxy constant anycallRouter = IAnycallV6Proxy(0xC10Ef9F491C9B59f936957026020C321651ac078);
    uint constant FLAG_PAY_FEE_ON_SRC = 0x1 << 1;

    // Map of anyswap entries (tokenId => chainId => entry)
    mapping(Const.TokenID => mapping(uint => AnyswapMap.Entry)) public anyswapMap;

    IAnycallExecutor public anycallExecutor;

    event Transfer(address from, address indexed token, uint indexed amount, uint indexed toChainId, address to);

    function initialize() public virtual override initializer {
        super.initialize();

        AnyswapMap.initMap(anyswapMap);
        
        uint chainId = Token.getChainID();
        AnyswapMap.Entry memory entry;
        entry = anyswapMap[Const.TokenID.USDT][chainId];
        IERC20Upgradeable(entry.underlying).safeApprove(entry.router, type(uint).max);
        entry = anyswapMap[Const.TokenID.USDC][chainId];
        IERC20Upgradeable(entry.underlying).safeApprove(entry.router, type(uint).max);

        anycallExecutor = IAnycallExecutor(anycallRouter.executor());
    }

    function setAnyswapEntry(
        Const.TokenID _tokenId, uint _chainId,
        address _router, address _unterlying, address _anyToken,
        uint8 _underlyingDecimals, uint8 _anyTokenDecimals, uint _minimumSwap
    ) external onlyOwner {
        anyswapMap[_tokenId][_chainId] = AnyswapMap.Entry({
            router: _router,
            underlying: _unterlying,
            anyToken: _anyToken,
            underlyingDecimals: _underlyingDecimals,
            anyTokenDecimals: _anyTokenDecimals,
            minimumSwap: _minimumSwap
        });
        if (IERC20Upgradeable(_unterlying).allowance(address(this), address(_router)) == 0) {
            IERC20Upgradeable(_unterlying).safeApprove(_router, type(uint).max);
        }
    }

    ///@dev The function to receive message from anycall router. The syntax must not be changed.
    function anyExecute(bytes calldata data) external returns (bool success, bytes memory result) {
        (address from, uint fromChainId,) = anycallExecutor.context();
        require(peers[fromChainId] == from, "Wrong context");

        (address targetContract, uint targetCallValue, bytes memory targetCallData)
            = abi.decode(data, (address, uint, bytes));
        (success, result) = targetContract.call{value: targetCallValue}(targetCallData);
    }

    function transfer(
        Const.TokenID _tokenId,
        uint[] memory _amounts,
        uint[] memory _toChainIds,
        address[] memory _toAddresses
    ) external payable override onlyRole(CLIENT_ROLE) {
        require(msg.value == 0, "No fee needed");
        uint count = _amounts.length;
        uint chainId = Token.getChainID();
        address from = _msgSender();

        uint amount;
        for (uint i = 0; i < count; i++) {
            amount += _amounts[i];
        }
        IERC20Upgradeable(anyswapMap[_tokenId][chainId].underlying).safeTransferFrom(from, address(this), amount);

        for (uint i = 0; i < count; i++) {
            _transfer(_tokenId, _amounts[i], chainId, _toChainIds[i], _toAddresses[i]);
        }
    }

    function _transfer(
        Const.TokenID _tokenId,
        uint _amount,
        uint _chainId,
        uint _toChainId,
        address _to
    ) internal {
        AnyswapMap.Entry memory entry = anyswapMap[_tokenId][_chainId];
        require(_amount >= (anyswapMap[_tokenId][_toChainId].minimumSwap * (10 ** entry.underlyingDecimals)), "Too small amount");

        IAnyswapV6Router(entry.router).anySwapOutUnderlying(entry.anyToken, _to, _amount, _toChainId);
        emit Transfer(msg.sender, entry.underlying, _amount, _toChainId, _to);
    }

    function call(
        uint _toChainId,
        address _targetContract,
        uint _targetCallValue,
        bytes memory _targetCallData
    ) external payable virtual override onlyRole(CLIENT_ROLE) {
        address peer = peers[_toChainId];
        require(peer != address(0), "No peer");

        bytes memory message = abi.encode(_targetContract, _targetCallValue, _targetCallData);
        anycallRouter.anyCall{value: msg.value}(peer, message, address(0), _toChainId, FLAG_PAY_FEE_ON_SRC);
    }

    function calcCallFee(
        uint _toChainId,
        address _targetContract,
        uint _targetCallValue,
        bytes memory _targetCallData
    ) public view virtual override returns (uint) {
        bytes memory message = abi.encode(_targetContract, _targetCallValue, _targetCallData);
        return anycallRouter.calcSrcFees("", _toChainId, message.length);
    }
}
