require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'OnDeviceVision'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/gil4him/trackbyphoto'
  s.author = package['author']
  s.source = { :git => 'https://github.com/gil4him/trackbyphoto.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/OnDeviceVisionPlugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '17.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
