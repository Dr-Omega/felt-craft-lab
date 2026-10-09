import coinUrl from '../../../../assets/ui/rewards/coin.png'
import diamondUrl from '../../../../assets/ui/rewards/diamond.png'
import appleUrl from '../../../../assets/ui/rewards/apple.png'
import honeyUrl from '../../../../assets/ui/rewards/honey.png'
import fishUrl from '../../../../assets/ui/rewards/fish.png'
import bearRoomUrl from '../../../../assets/ui/rewards/bear-room.png'
import communityCardUrl from '../../../../assets/ui/rewards/community/community-card.png'
import publishCardUrl from '../../../../assets/ui/rewards/community/publish-card.png'
import mailBannerUrl from '../../../../assets/ui/rewards/community/mail-banner.png'
import likeOffUrl from '../../../../assets/ui/rewards/community/like-off.png'
import likeOnUrl from '../../../../assets/ui/rewards/community/like-on.png'
import commentIconUrl from '../../../../assets/ui/rewards/community/comment-icon.png'
import reviewFrameUrl from '../../../../assets/ui/rewards/community/review-frame.png'
import reviewInputUrl from '../../../../assets/ui/rewards/community/review-input.png'
import teacherLevelOneUrl from '../../../../assets/ui/rewards/community/teacher-level-1.png'
import teacherLevelTwoUrl from '../../../../assets/ui/rewards/community/teacher-level-2.png'
import teacherLevelThreeUrl from '../../../../assets/ui/rewards/community/teacher-level-3.png'
import teacherLevelFourUrl from '../../../../assets/ui/rewards/community/teacher-level-4.png'
import growthBackgroundUrl from '../../../../assets/ui/rewards/growth-center/background.png'
import growthFrameOverlayUrl from '../../../../assets/ui/rewards/growth-center/frame-overlay.png'
import growthBasePanelSourceUrl from '../../../../assets/ui/rewards/growth-center/base-panel.png'
import growthBasePanelNineSliceUrl from '../../../../assets/ui/rewards/growth-center/base-panel-9slice.png'
import growthCardSourceUrl from '../../../../assets/ui/rewards/growth-center/card-source.png'
import growthCardNineSliceUrl from '../../../../assets/ui/rewards/growth-center/card-9slice.png'
import blindBoxBearUrl from '../../../../assets/ui/rewards/blind-box/bear.jpg'
import blindBoxCatUrl from '../../../../assets/ui/rewards/blind-box/cat.jpg'
import blindBoxChickUrl from '../../../../assets/ui/rewards/blind-box/chick.jpg'
import blindBoxDogUrl from '../../../../assets/ui/rewards/blind-box/dog.jpg'

export const rewardAssets = {
  coin: coinUrl,
  diamond: diamondUrl,
  apple: appleUrl,
  honey: honeyUrl,
  fish: fishUrl,
  bearRoom: bearRoomUrl,
  communityCard: communityCardUrl,
  publishCard: publishCardUrl,
  mailBanner: mailBannerUrl,
  likeOff: likeOffUrl,
  likeOn: likeOnUrl,
  commentIcon: commentIconUrl,
  reviewFrame: reviewFrameUrl,
  reviewInput: reviewInputUrl,
  growthCenter: {
    background: growthBackgroundUrl,
    frameOverlay: growthFrameOverlayUrl,
    basePanelSource: growthBasePanelSourceUrl,
    basePanelNineSlice: growthBasePanelNineSliceUrl,
    cardSource: growthCardSourceUrl,
    cardNineSlice: growthCardNineSliceUrl
  },
  blindBox: [
    { id: 'bear', name: '爱心小熊', src: blindBoxBearUrl },
    { id: 'cat', name: '好奇小猫', src: blindBoxCatUrl },
    { id: 'chick', name: '自信小鸡', src: blindBoxChickUrl },
    { id: 'dog', name: '灵感小狗', src: blindBoxDogUrl }
  ],
  teacherLevels: {
    ordinary: teacherLevelOneUrl,
    intermediate: teacherLevelTwoUrl,
    advanced: teacherLevelThreeUrl,
    expert: teacherLevelFourUrl
  }
} as const
