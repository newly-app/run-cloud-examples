import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ProofViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class ProofViewController: UIViewController {
    private let gradient = CAGradientLayer()

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        gradient.colors = [
            UIColor(red: 0.02, green: 0.05, blue: 0.08, alpha: 1).cgColor,
            UIColor(red: 0.03, green: 0.13, blue: 0.17, alpha: 1).cgColor,
        ]
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        view.layer.insertSublayer(gradient, at: 0)

        let mark = UILabel()
        mark.text = "▱  run.cloud"
        mark.font = .monospacedSystemFont(ofSize: 21, weight: .bold)
        mark.textColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 1)

        let eyebrow = label("NATIVE iOS APP", size: 13, weight: .semibold)
        eyebrow.textColor = UIColor(red: 0.65, green: 0.75, blue: 0.81, alpha: 1)

        let title = label("Upload.\nLaunch.\nScreenshot.", size: 44, weight: .bold)
        title.numberOfLines = 3

        let detail = label(
            "This screen was compiled from Swift source, uploaded as an app archive, and launched in a run.cloud simulator.",
            size: 17,
            weight: .regular
        )
        detail.numberOfLines = 0
        detail.textColor = UIColor(red: 0.72, green: 0.80, blue: 0.84, alpha: 1)

        let steps = UIStackView(arrangedSubviews: [
            step(number: "01", title: "APP UPLOADED"),
            step(number: "02", title: "SIMULATOR STARTED"),
            step(number: "03", title: "PNG CAPTURED"),
        ])
        steps.axis = .vertical
        steps.spacing = 10

        let content = UIStackView(arrangedSubviews: [mark, spacer(42), eyebrow, spacer(12), title, spacer(22), detail, spacer(34), steps])
        content.axis = .vertical
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)

        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 28),
            content.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -28),
            content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 26),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gradient.frame = view.bounds
    }

    private func label(_ text: String, size: CGFloat, weight: UIFont.Weight) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = .white
        return label
    }

    private func spacer(_ height: CGFloat) -> UIView {
        let spacer = UIView()
        spacer.heightAnchor.constraint(equalToConstant: height).isActive = true
        return spacer
    }

    private func step(number: String, title: String) -> UIView {
        let numberLabel = label(number, size: 13, weight: .bold)
        numberLabel.font = .monospacedSystemFont(ofSize: 13, weight: .bold)
        numberLabel.textColor = UIColor(red: 0.55, green: 0.93, blue: 0.57, alpha: 1)

        let titleLabel = label(title, size: 14, weight: .semibold)
        titleLabel.font = .monospacedSystemFont(ofSize: 14, weight: .semibold)

        let row = UIStackView(arrangedSubviews: [numberLabel, titleLabel])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 18
        row.translatesAutoresizingMaskIntoConstraints = false

        let card = UIView()
        card.backgroundColor = UIColor.white.withAlphaComponent(0.07)
        card.layer.borderColor = UIColor.white.withAlphaComponent(0.12).cgColor
        card.layer.borderWidth = 1
        card.layer.cornerRadius = 12
        card.addSubview(row)

        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            row.trailingAnchor.constraint(lessThanOrEqualTo: card.trailingAnchor, constant: -16),
            row.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            row.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])
        return card
    }
}
