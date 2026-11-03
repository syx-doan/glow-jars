# Glow Jars trên iPhone

Dự án Xcode nằm trong `ios/App`. Bản này hỗ trợ iPhone chạy iOS 16.4 trở lên và khóa màn hình dọc.

## Chạy trên iPhone

Trên máy Mac, cài Node.js 20.19.x hoặc từ 22.12 trở lên, Xcode và CocoaPods. Mở Terminal tại thư mục gốc của dự án:

```sh
npm ci
npm run ios:sync
npm run ios:open
```

Trong Xcode, chọn target **App**, mở **Signing & Capabilities**, chọn tài khoản và Team Apple Developer. Kiểm tra Bundle Identifier `com.glowjars.app` và đổi nếu tài khoản của bạn không sử dụng được định danh này. Kết nối iPhone hoặc chọn trình giả lập, sau đó nhấn Run.

Để phát hành qua TestFlight hoặc App Store, dùng Xcode 26 trở lên với iOS 26 SDK trở lên, chọn thiết bị **Any iOS Device**, chọn **Product → Archive** và làm theo hướng dẫn phân phối trong Xcode. Cần tài khoản Apple Developer và cấu hình ký phù hợp.

Chuẩn bị chính sách quyền riêng tư và thông tin App Privacy trong App Store Connect theo cấu hình thực tế của bản iOS. Trang `public/privacy.html` hiện mô tả bản Android và cần được cập nhật hoặc thay bằng chính sách phù hợp cho iOS trước khi phát hành.

## Quảng cáo iOS

Mặc định chưa có đơn vị quảng cáo iOS thật. Các nút thưởng bằng quảng cáo được ẩn, còn công cụ cứu màn được cấp miễn phí khi người chơi không đủ xu. Firebase cũng chưa được bật.

Để thử quảng cáo của Google trên iPhone, đồng bộ bằng lệnh sau rồi chạy lại từ Xcode:

```sh
VITE_TEST_ADS=1 npm run ios:sync
```

Để bật quảng cáo thật, tạo ứng dụng iOS và ba đơn vị quảng cáo banner, rewarded và interstitial trong AdMob. Thay giá trị `GADApplicationIdentifier` trong `ios/App/App/Info.plist` bằng App ID iOS của bạn. Sau đó build lại với cả ba ID đơn vị:

```sh
VITE_IOS_ADMOB_BANNER_ID="ca-app-pub-.../..." \
VITE_IOS_ADMOB_REWARDED_ID="ca-app-pub-.../..." \
VITE_IOS_ADMOB_INTERSTITIAL_ID="ca-app-pub-.../..." \
npm run ios:sync
```

Các giá trị này được nhúng vào bundle khi build. Chạy lại lệnh trên sau mỗi lần thay đổi. Thay App ID mẫu và các ID mẫu trước khi phát hành quảng cáo thật.

## Firebase cho iOS

Khi có cấu hình Firebase riêng cho iOS, đăng ký ứng dụng với đúng Bundle Identifier, tải `GoogleService-Info.plist` và thêm file vào target **App** trong Xcode với **Copy items if needed** và **Add to targets: App**. File này được git bỏ qua.

Thêm `@capacitor-firebase/analytics` và `@capacitor-firebase/remote-config` vào mảng `ios.includePlugins` trong `capacitor.config.json`. Trong `ios/App/Podfile`, thêm dòng sau bên dưới `# Add your Pods here`:

```ruby
pod 'CapacitorFirebaseAnalytics/AnalyticsWithoutAdIdSupport', :path => '../../node_modules/@capacitor-firebase/analytics'
```

Chạy lại `npm run ios:sync`, mở workspace và build lại. Đảm bảo plist đã được thêm vào target trước khi chạy ứng dụng với các plugin Firebase.
