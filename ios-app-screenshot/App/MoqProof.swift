import UIKit

/// Native clock pixels travel through the same capture and decode path as the app.
final class MoqProofView: UIView {
    private let target = UIButton(type: .custom)
    private let clock = MoqBinaryClockView()
    private var count = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        target.accessibilityIdentifier = "moq-tap-target"
        target.titleLabel?.font = .monospacedSystemFont(ofSize: 16, weight: .bold)
        target.setTitleColor(.white, for: .normal)
        target.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        addSubview(target)
        addSubview(clock)
        updateTarget()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        target.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 42)
        clock.frame = CGRect(x: 0, y: 46, width: bounds.width, height: 24)
    }

    @objc private func tapped() { count += 1; updateTarget() }

    private func updateTarget() {
        target.setTitle("MoQ taps: \(count)", for: .normal)
        target.accessibilityLabel = "MoQ tap counter"
        target.accessibilityValue = String(count)
        target.backgroundColor = [UIColor.systemBlue, .systemRed, .systemGreen][count % 3]
    }
}

private final class MoqClockTicker: NSObject {
    weak var view: MoqBinaryClockView?
    @objc func tick() { view?.setNeedsDisplay() }
}

private final class MoqBinaryClockView: UIView {
    private let ticker = MoqClockTicker()
    private var link: CADisplayLink?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isOpaque = true
        isAccessibilityElement = true
        accessibilityIdentifier = "moq-clock"
        accessibilityLabel = "36-bit wall clock, milliseconds modulo 68719476736"
        ticker.view = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { link?.invalidate() }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        link?.invalidate()
        link = nil
        if window != nil {
            let next = CADisplayLink(target: ticker, selector: #selector(MoqClockTicker.tick))
            next.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 60, preferred: 60)
            next.add(to: .main, forMode: .common)
            link = next
        }
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let value = UInt64(Date().timeIntervalSince1970 * 1000) & ((1 << 36) - 1)
        var bits: [Int] = [0, 1, 0]
        for shift in stride(from: 35, through: 0, by: -1) {
            bits.append(Int((value >> UInt64(shift)) & UInt64(1)))
        }
        bits.append(contentsOf: [1, 0, 1])
        context.setAllowsAntialiasing(false)
        context.setFillColor(UIColor.black.cgColor)
        context.fill(bounds)
        let cell = bounds.width / 42
        context.setFillColor(UIColor.white.cgColor)
        for (index, bit) in bits.enumerated() where bit == 1 {
            context.fill(CGRect(x: CGFloat(index) * cell, y: 0, width: cell, height: bounds.height))
        }
    }
}
