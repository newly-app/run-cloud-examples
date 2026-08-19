import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let proofViewController = ProofViewController()
        window.rootViewController = proofViewController
        window.makeKeyAndVisible()
        self.window = window
        if let url = launchOptions?[.url] as? URL {
            showDeepLink(url, delivery: "cold")
        } else if let request = MediaProofRequest.restore() {
            window.rootViewController = MediaProofViewController(request: request)
        }
        return true
    }

    func application(
        _ application: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        guard url.scheme?.lowercased() == "runcloudproof" else { return false }
        showDeepLink(url, delivery: "warm")
        return true
    }

    private func showDeepLink(_ url: URL, delivery: String) {
        if let request = MediaProofRequest(url: url) {
            request.persist()
            window?.rootViewController = MediaProofViewController(request: request)
            return
        }
        MediaProofRequest.clear()
        let proofViewController = ProofViewController()
        proofViewController.loadViewIfNeeded()
        proofViewController.showDeepLink(url, delivery: delivery)
        window?.rootViewController = proofViewController
    }
}

final class ProofViewController: UIViewController, UITextFieldDelegate, UIScrollViewDelegate {
    private let gradient = CAGradientLayer()
    private let deepLinkState = ProofViewController.deepLinkStatus()
    private let tapState = ProofViewController.status("Tap count: 0", id: "tap-state")
    private let swipeState = ProofViewController.status("Swipe: idle", id: "swipe-state")
    private let gestureState = ProofViewController.status("Gesture: idle", id: "gesture-state")
    private let keyState = ProofViewController.status("Key: none", id: "key-state")
    private let accessibilityState = ProofViewController.status(
        "Notifications: off · Screen: overview",
        id: "accessibility-state"
    )
    private let accessibilityNestedLabel = ProofViewController.status(
        "Nested label: overview",
        id: "nested-label"
    )
    private let notificationsToggle = UISwitch()
    private let navigationButton = UIButton(type: .system)
    private var tapCount = 0
    private var showingAccessibilityDetails = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        [
            keyCommand(UIKeyCommand.inputUpArrow, name: "ArrowUp"),
            keyCommand(UIKeyCommand.inputDownArrow, name: "ArrowDown"),
            keyCommand(UIKeyCommand.inputLeftArrow, name: "ArrowLeft"),
            keyCommand(UIKeyCommand.inputRightArrow, name: "ArrowRight"),
            keyCommand("\r", name: "Enter"),
            keyCommand("\u{1b}", name: "Escape"),
        ]
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        gradient.colors = [
            UIColor(red: 0.02, green: 0.05, blue: 0.08, alpha: 1).cgColor,
            UIColor(red: 0.03, green: 0.16, blue: 0.20, alpha: 1).cgColor,
        ]
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        view.layer.insertSublayer(gradient, at: 0)

        let mark = label("▱  run.cloud interaction proof", size: 19, weight: .bold)
        mark.font = .monospacedSystemFont(ofSize: 19, weight: .bold)
        mark.textColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 1)

        let stateColumn = UIStackView(arrangedSubviews: [tapState, swipeState, gestureState, keyState])
        stateColumn.axis = .vertical
        stateColumn.spacing = 3

        let tapButton = UIButton(type: .system)
        tapButton.setTitle("TAP TARGET", for: .normal)
        tapButton.titleLabel?.font = .monospacedSystemFont(ofSize: 16, weight: .bold)
        tapButton.setTitleColor(.white, for: .normal)
        tapButton.backgroundColor = UIColor(red: 0.10, green: 0.38, blue: 0.46, alpha: 1)
        tapButton.layer.cornerRadius = 12
        tapButton.layer.borderColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 0.7).cgColor
        tapButton.layer.borderWidth = 1
        tapButton.accessibilityIdentifier = "tap-target"
        tapButton.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        tapButton.heightAnchor.constraint(equalToConstant: 54).isActive = true

        let textInput = UITextField()
        textInput.delegate = self
        textInput.placeholder = "Type text here"
        textInput.accessibilityIdentifier = "text-input"
        textInput.accessibilityLabel = "Proof text input"
        textInput.textColor = .white
        textInput.tintColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 1)
        textInput.backgroundColor = UIColor.white.withAlphaComponent(0.09)
        textInput.layer.cornerRadius = 12
        textInput.layer.borderColor = UIColor.white.withAlphaComponent(0.25).cgColor
        textInput.layer.borderWidth = 1
        textInput.returnKeyType = .done
        textInput.autocorrectionType = .no
        textInput.autocapitalizationType = .none
        textInput.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        textInput.leftViewMode = .always
        textInput.heightAnchor.constraint(equalToConstant: 50).isActive = true

        let gestureArea = GestureProofView()
        gestureArea.accessibilityIdentifier = "gesture-area"
        gestureArea.accessibilityLabel = "Gesture proof area"
        gestureArea.onState = { [weak self] state in self?.gestureState.text = "Gesture: \(state)" }
        gestureArea.heightAnchor.constraint(equalToConstant: 126).isActive = true

        let scrollView = makeScrollProof()
        scrollView.heightAnchor.constraint(equalToConstant: 190).isActive = true

        let accessibilityProof = makeAccessibilityProof()

        let content = UIStackView(arrangedSubviews: [
            mark,
            stateColumn,
            tapButton,
            textInput,
            gestureArea,
            scrollView,
            accessibilityProof,
        ])
        content.axis = .vertical
        content.spacing = 9
        content.translatesAutoresizingMaskIntoConstraints = false

        let page = UIScrollView()
        page.alwaysBounceVertical = false
        page.delaysContentTouches = false
        page.canCancelContentTouches = false
        page.keyboardDismissMode = .interactive
        page.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(page)
        page.addSubview(content)
        view.addSubview(deepLinkState)

        NSLayoutConstraint.activate([
            page.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            page.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            page.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            page.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: page.contentLayoutGuide.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: page.contentLayoutGuide.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: page.contentLayoutGuide.topAnchor, constant: 14),
            content.bottomAnchor.constraint(equalTo: page.contentLayoutGuide.bottomAnchor, constant: -12),
            content.widthAnchor.constraint(equalTo: page.frameLayoutGuide.widthAnchor, constant: -48),
            deepLinkState.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            deepLinkState.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            deepLinkState.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
        ])
    }

    func showDeepLink(_ url: URL, delivery: String) {
        deepLinkState.text = "Deep link (\(delivery)):\n\(url.absoluteString)"
        deepLinkState.accessibilityValue = url.absoluteString
        deepLinkState.isHidden = false
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gradient.frame = view.bounds
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if let key = presses.first?.key {
            let value = key.charactersIgnoringModifiers
            if !value.isEmpty {
                showKey(readableKey(value, modifiers: key.modifierFlags))
            }
        }
        super.pressesBegan(presses, with: event)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        showKey("Enter")
        textField.resignFirstResponder()
        becomeFirstResponder()
        return true
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if scrollView.contentOffset.y > 24 {
            swipeState.text = "Swipe: moved"
        }
    }

    @objc private func tapped() {
        tapCount += 1
        tapState.text = "Tap count: \(tapCount)"
    }

    @objc private func notificationsChanged() {
        updateAccessibilityState()
    }

    @objc private func navigateAccessibilityProof() {
        showingAccessibilityDetails.toggle()
        accessibilityNestedLabel.text = showingAccessibilityDetails
            ? "Nested label: details"
            : "Nested label: overview"
        navigationButton.setTitle(
            showingAccessibilityDetails ? "BACK TO OVERVIEW" : "OPEN DETAILS",
            for: .normal
        )
        navigationButton.accessibilityLabel = showingAccessibilityDetails
            ? "Back to overview"
            : "Open details"
        updateAccessibilityState()
    }

    private func updateAccessibilityState() {
        accessibilityState.text = "Notifications: \(notificationsToggle.isOn ? "on" : "off")"
            + " · Screen: \(showingAccessibilityDetails ? "details" : "overview")"
    }

    @objc private func keyPressed(_ sender: UIKeyCommand) {
        let input = sender.discoverabilityTitle ?? readableKey(sender.input ?? "unknown")
        showKey(readableKey(input, modifiers: sender.modifierFlags))
    }

    private func showKey(_ value: String) {
        keyState.text = "Key: \(value)"
    }

    private func keyCommand(_ input: String, name: String) -> UIKeyCommand {
        let command = UIKeyCommand(input: input, modifierFlags: [], action: #selector(keyPressed(_:)))
        command.discoverabilityTitle = name
        return command
    }

    private func readableKey(
        _ input: String,
        modifiers: UIKeyModifierFlags = []
    ) -> String {
        let key: String
        switch input {
        case UIKeyCommand.inputUpArrow: key = "ArrowUp"
        case UIKeyCommand.inputDownArrow: key = "ArrowDown"
        case UIKeyCommand.inputLeftArrow: key = "ArrowLeft"
        case UIKeyCommand.inputRightArrow: key = "ArrowRight"
        case "\r", "\n": key = "Enter"
        case "\u{1b}": key = "Escape"
        default: key = input
        }
        var names: [String] = []
        if modifiers.contains(.control) { names.append("Control") }
        if modifiers.contains(.alternate) { names.append("Option") }
        if modifiers.contains(.shift) { names.append("Shift") }
        if modifiers.contains(.command) { names.append("Command") }
        names.append(key)
        return names.joined(separator: "+")
    }

    private func makeScrollProof() -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = self
        scroll.accessibilityIdentifier = "swipe-scroll"
        scroll.accessibilityLabel = "Swipe proof scroll area"
        scroll.backgroundColor = UIColor.white.withAlphaComponent(0.05)
        scroll.layer.cornerRadius = 12
        scroll.layer.borderColor = UIColor.white.withAlphaComponent(0.16).cgColor
        scroll.layer.borderWidth = 1
        scroll.showsVerticalScrollIndicator = true

        let cards = UIStackView(arrangedSubviews: [
            scrollCard("SWIPE AREA", detail: "Swipe up inside this panel"),
            scrollCard("KEEP GOING", detail: "The state above changes after movement"),
            scrollCard("SWIPE COMPLETE", detail: "This card confirms the viewport moved"),
        ])
        cards.axis = .vertical
        cards.spacing = 12
        cards.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(cards)
        NSLayoutConstraint.activate([
            cards.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 12),
            cards.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -12),
            cards.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            cards.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            cards.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -24),
        ])
        return scroll
    }

    private func makeAccessibilityProof() -> UIView {
        let heading = label("ACCESSIBILITY PROOF", size: 15, weight: .bold)
        heading.font = .monospacedSystemFont(ofSize: 15, weight: .bold)
        heading.textColor = UIColor(red: 0.55, green: 0.93, blue: 0.57, alpha: 1)
        heading.accessibilityIdentifier = "accessibility-heading"
        heading.accessibilityTraits.insert(.header)

        let name = proofTextField(
            placeholder: "Name",
            id: "name-field",
            label: "Name",
            value: "Ada"
        )
        let password = proofTextField(
            placeholder: "Password",
            id: "password-field",
            label: "Password",
            value: "runcloud-secret-42"
        )
        password.isSecureTextEntry = true

        let toggleLabel = label("Notifications", size: 14, weight: .medium)
        toggleLabel.accessibilityIdentifier = "notifications-label"
        notificationsToggle.accessibilityIdentifier = "notifications-toggle"
        notificationsToggle.accessibilityLabel = "Notifications"
        notificationsToggle.isOn = false
        notificationsToggle.addTarget(
            self,
            action: #selector(notificationsChanged),
            for: .valueChanged
        )
        let toggleRow = UIStackView(arrangedSubviews: [toggleLabel, notificationsToggle])
        toggleRow.axis = .horizontal
        toggleRow.alignment = .center
        toggleRow.distribution = .equalSpacing

        let disabled = UIButton(type: .system)
        disabled.setTitle("SUBMIT DISABLED", for: .normal)
        disabled.accessibilityIdentifier = "disabled-submit"
        disabled.accessibilityLabel = "Submit"
        disabled.isEnabled = false

        navigationButton.setTitle("OPEN DETAILS", for: .normal)
        navigationButton.accessibilityIdentifier = "navigate-button"
        navigationButton.accessibilityLabel = "Open details"
        navigationButton.addTarget(
            self,
            action: #selector(navigateAccessibilityProof),
            for: .touchUpInside
        )
        let buttons = UIStackView(arrangedSubviews: [disabled, navigationButton])
        buttons.axis = .horizontal
        buttons.distribution = .fillEqually
        buttons.spacing = 8
        buttons.heightAnchor.constraint(equalToConstant: 42).isActive = true

        let stack = UIStackView(arrangedSubviews: [
            heading,
            accessibilityNestedLabel,
            accessibilityState,
            name,
            password,
            toggleRow,
            buttons,
        ])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.accessibilityContainerType = .semanticGroup

        let card = UIView()
        card.accessibilityIdentifier = "accessibility-card"
        card.backgroundColor = UIColor.white.withAlphaComponent(0.07)
        card.layer.cornerRadius = 12
        card.layer.borderColor = UIColor.white.withAlphaComponent(0.18).cgColor
        card.layer.borderWidth = 1
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])
        return card
    }

    private func proofTextField(
        placeholder: String,
        id: String,
        label: String,
        value: String
    ) -> UITextField {
        let field = UITextField()
        field.placeholder = placeholder
        field.accessibilityIdentifier = id
        field.accessibilityLabel = label
        field.text = value
        field.textColor = .white
        field.tintColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 1)
        field.backgroundColor = UIColor.white.withAlphaComponent(0.09)
        field.layer.cornerRadius = 9
        field.layer.borderColor = UIColor.white.withAlphaComponent(0.22).cgColor
        field.layer.borderWidth = 1
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        field.leftViewMode = .always
        field.heightAnchor.constraint(equalToConstant: 40).isActive = true
        return field
    }

    private func scrollCard(_ title: String, detail: String) -> UIView {
        let titleLabel = label(title, size: 14, weight: .bold)
        titleLabel.font = .monospacedSystemFont(ofSize: 14, weight: .bold)
        titleLabel.textColor = UIColor(red: 0.55, green: 0.93, blue: 0.57, alpha: 1)
        let detailLabel = label(detail, size: 13, weight: .regular)
        detailLabel.textColor = UIColor(red: 0.72, green: 0.80, blue: 0.84, alpha: 1)
        detailLabel.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [titleLabel, detailLabel])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        let card = UIView()
        card.backgroundColor = UIColor.white.withAlphaComponent(0.07)
        card.layer.cornerRadius = 10
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
            card.heightAnchor.constraint(equalToConstant: 112),
        ])
        return card
    }

    private func label(_ text: String, size: CGFloat, weight: UIFont.Weight) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = .white
        return label
    }

    private static func status(_ text: String, id: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .monospacedSystemFont(ofSize: 13, weight: .medium)
        label.textColor = UIColor(red: 0.78, green: 0.86, blue: 0.90, alpha: 1)
        label.accessibilityIdentifier = id
        return label
    }

    private static func deepLinkStatus() -> UILabel {
        let label = status("", id: "deep-link-state")
        label.font = .monospacedSystemFont(ofSize: 12, weight: .semibold)
        label.backgroundColor = UIColor(red: 0.02, green: 0.12, blue: 0.16, alpha: 0.96)
        label.layer.cornerRadius = 10
        label.layer.borderColor = UIColor(red: 0.46, green: 0.91, blue: 0.98, alpha: 0.8).cgColor
        label.layer.borderWidth = 1
        label.layer.masksToBounds = true
        label.lineBreakMode = .byCharWrapping
        label.numberOfLines = 0
        label.isHidden = true
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }
}

final class GestureProofView: UILabel {
    var onState: ((String) -> Void)?
    private var origin = CGPoint.zero
    private var maximumTouches = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        isMultipleTouchEnabled = true
        numberOfLines = 0
        textAlignment = .center
        text = "GESTURE AREA\nDrag, hold, or use two fingers"
        font = .monospacedSystemFont(ofSize: 14, weight: .bold)
        textColor = .white
        backgroundColor = UIColor(red: 0.16, green: 0.25, blue: 0.38, alpha: 1)
        layer.cornerRadius = 12
        layer.borderColor = UIColor(red: 0.55, green: 0.65, blue: 1.0, alpha: 0.8).cgColor
        layer.borderWidth = 1
        clipsToBounds = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        origin = touches.first?.location(in: self) ?? .zero
        maximumTouches = event?.allTouches?.count ?? touches.count
        onState?(maximumTouches > 1 ? "multi-touch" : "started")
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        maximumTouches = max(maximumTouches, event?.allTouches?.count ?? touches.count)
        let point = touches.first?.location(in: self) ?? origin
        let distance = hypot(point.x - origin.x, point.y - origin.y)
        if maximumTouches > 1 {
            onState?("multi-touch")
        } else if distance > 12 {
            onState?("dragging")
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        onState?(maximumTouches > 1 ? "multi-touch complete" : "complete")
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        onState?("cancelled")
    }
}
