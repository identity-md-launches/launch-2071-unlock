// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {UnlkImdOracle} from "src/mainnet/UnlkImdOracle.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {IClaimEvidence} from "src/interfaces/IIntegration.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
interface WebsiteRouter {function execute(bytes calldata,bytes[] calldata,uint256) external payable;}
interface WebsitePermit {function approve(address,address,uint160,uint48) external;}
interface WebsiteQuoter {struct Quote {PoolKey poolKey;bool zeroForOne;uint128 exactAmount;bytes hookData;}function quoteExactInputSingle(Quote calldata) external returns(uint256,uint256);}
interface WebsiteDistributor {function claim(uint256,address,uint256,bytes32[] calldata) external;function claimed(uint256,address) external view returns(bool);}
/// Local fork only. No broadcast or private keys. Real deployed 2071 contracts; only IMD test funding is injected.
contract MainnetWebsiteFork is Test {
 UnlkImdHook hook=UnlkImdHook(0x932EbA7E96b9e54efe6f8Cdf98CB092164A57fcc);
 IERC20 token=IERC20(0x99fA82B022BE4575891a43b757Bc770691E18fDa);
 IERC20 imd=IERC20(0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7);
 address router=0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
 address permit=0x000000000022D473030F116dDEE9F6B43aC78BA3;
 address quoter=0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
 address owner=0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;
 MerkleClaimEvidence evidence=MerkleClaimEvidence(0x31d8c50C3c2D7C6000f1AC8CFD466404d26232Ab);
 WebsiteDistributor distributor=WebsiteDistributor(0xc70795E2D8dFAC6131038dcbA84aA2AAeD1CEed1);
 ImdFeeVault vault=ImdFeeVault(0xf2a19fBA1f37f3FD41Af0B7f671CCF6D07f29f50);
 struct ExactIn {PoolKey poolKey;bool zeroForOne;uint128 amountIn;uint128 amountOutMinimum;bytes hookData;}
 PoolKey key;
 address trader;
 function setUp() public {vm.createSelectFork(vm.envOr("UNLK_FORK_RPC",string("https://eth.drpc.org")),26212727);trader=makeAddr("local-only-trader");assertEq(block.chainid,1);assertFalse(hook.activated());key=hook.poolKey();}
 function _activate() internal {vm.prank(owner);hook.configureAndActivate(IClaimEvidence(address(evidence)),UnlkImdOracle(0x13CD2D5452cac5e71CA16e825E280563a874C6B6),2071);assertTrue(hook.activated());}
 function _fundAndApprove() internal {deal(address(imd),trader,100 ether);vm.startPrank(trader);imd.approve(permit,type(uint256).max);token.approve(permit,type(uint256).max);WebsitePermit(permit).approve(address(imd),router,type(uint160).max,uint48(block.timestamp+1800));WebsitePermit(permit).approve(address(token),router,type(uint160).max,uint48(block.timestamp+1800));vm.stopPrank();}
 function _swap(bool buy,uint128 amount,uint128 minimum) internal {bytes[] memory params=new bytes[](3);params[0]=abi.encode(ExactIn(key,!buy,amount,minimum,bytes("")));params[1]=abi.encode(buy?address(imd):address(token),uint256(amount));params[2]=abi.encode(buy?address(token):address(imd),uint256(minimum));bytes[] memory inputs=new bytes[](1);inputs[0]=abi.encode(hex"060c0f",params);vm.prank(trader);WebsiteRouter(router).execute(hex"10",inputs,block.timestamp+300);}
 function testInactiveRouterRejected() public {_fundAndApprove();vm.expectRevert();_swap(true,1 ether,1);}
 function testLocalActivationRealRouterQuotaFeeAndMaturity() public {
  _activate();_fundAndApprove();(uint256 out,)=WebsiteQuoter(quoter).quoteExactInputSingle(WebsiteQuoter.Quote(hook.poolKey(),false,1 ether,""));
  uint256 beforeImd=imd.balanceOf(trader);uint256 beforeAccrued=vault.totalAccrued();_swap(true,1 ether,uint128(out*995/1000));
  assertEq(token.balanceOf(trader),out);assertEq(beforeImd-imd.balanceOf(trader),1 ether);assertEq(hook.eligible(trader),out);assertEq(hook.spendableEligible(trader),0);assertEq(hook.remainingQuota(trader),0);
  assertGt(vault.totalAccrued(),beforeAccrued);uint256 poolInput=uint256(1 ether)*10000/10075; if(poolInput+1+(poolInput+1)*75/10000<=1 ether)poolInput++;
  assertEq(vault.totalAccrued()-beforeAccrued,1 ether-poolInput);
  vm.expectRevert();_swap(false,uint128(out/10),1);vm.roll(block.number+1);assertEq(hook.spendableEligible(trader),out);
  uint256 quota=hook.remainingQuota(trader);(uint256 generic,)=WebsiteQuoter(quoter).quoteExactInputSingle(WebsiteQuoter.Quote(hook.poolKey(),true,uint128(quota+1),""));assertGt(generic,0);
  vm.expectRevert();_swap(false,uint128(quota+1),1);
  uint256 sale=quota/2;uint256 beforeTokens=token.balanceOf(trader);uint256 feeBefore=vault.totalAccrued();uint256 imdBefore=imd.balanceOf(trader);_swap(false,uint128(sale),1);
  assertEq(beforeTokens-token.balanceOf(trader),sale);assertEq(hook.sold(trader),sale);assertEq(hook.remainingQuota(trader),quota-sale);assertGt(imd.balanceOf(trader),imdBefore);assertGt(vault.totalAccrued(),feeBefore);
  assertEq(vault.totalAccrued(),vault.totalRedeemed()+vault.pendingClaims());assertEq(vault.totalRedeemed(),vault.totalWithdrawn()+vault.claimable());
 }
 function testNativeClaimBeforeActivationAttestThenSeparateSync() public {
  (address account,uint256 amount,bytes32[] memory proof)=_allocation();assertFalse(distributor.claimed(0,account));uint256 beforeBal=token.balanceOf(account);
  distributor.claim(0,account,amount,proof);assertEq(token.balanceOf(account)-beforeBal,amount);assertEq(hook.eligible(account),0);
  evidence.attest(0,account,amount,proof);assertEq(evidence.claimed(account),amount);vm.expectRevert();hook.syncRewards(account);
  _activate();hook.syncRewards(account);assertEq(hook.eligible(account),amount);assertEq(hook.spendableEligible(account),amount);hook.syncRewards(account);assertEq(hook.eligible(account),amount);
  vm.expectRevert();distributor.claim(0,account,amount,proof);vm.expectRevert();evidence.attest(0,account,amount,proof);
 }
 function _allocation() internal pure returns(address account,uint256 amount,bytes32[] memory proof){
account=address(uint160(0x8A09064A767F3013F6FAdC99C187E4A28659614a));amount=77369439071566731141199;proof=new bytes32[](8);
proof[0]=0xb590df22ccc76712789d0cbbcdab2a7e01e31afc140668ab5e1519cd18b457b1;
proof[1]=0x56282ea37896a4651d9e856028115c2d6aa301e0dc67eca90c4809b70b5eeb8f;
proof[2]=0x2d1dca2bee102e519ffc795edd0c142af5e39484605c08fa69430022b08b83e0;
proof[3]=0xbcf832b20e081ad116c7308ad6ba532b8e17a1a1f6a3c334da78d2b9a6ffab46;
proof[4]=0x1f45063a5fbec5d925b94bb955bd4781f5626d16c3be222cee509a093d549c99;
proof[5]=0xcf1456e470ea513d3feefc1a1e5de864a84a6b9ec1b9758d1ba68947cd7a6a3f;
proof[6]=0x8664bc9f552129ee0721c4ab95e3ef898f4fa9f0cda5f72729c80a0bd20426a0;
proof[7]=0xf03e1c8dc25e89378f43e13ec4e1ee2cb2a300185c521d013152b8f22537ad47;
}
}
