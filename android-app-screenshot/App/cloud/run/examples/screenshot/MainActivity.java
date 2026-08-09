package cloud.run.examples.screenshot;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int CYAN = Color.rgb(117, 232, 250);
    private static final int GREEN = Color.rgb(140, 237, 145);
    private static final int MUTED = Color.rgb(195, 218, 226);
    private static final float TAP_TARGET_NORMALIZED_Y = 0.23f;
    private TextView tapState;
    private TextView swipeState;
    private TextView gestureState;
    private TextView keyState;
    private TextView accessibilityState;
    private TextView accessibilityNestedLabel;
    private Switch notificationsToggle;
    private Button navigationButton;
    private int tapCount;
    private boolean showingAccessibilityDetails;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(5, 18, 25));
        getWindow().setNavigationBarColor(Color.rgb(7, 31, 39));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(14), dp(24), dp(12));
        content.setFocusableInTouchMode(true);
        content.setBackground(new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] { Color.rgb(5, 13, 20), Color.rgb(8, 42, 51) }
        ));
        View proofTopSpacer = space(0);
        content.addView(proofTopSpacer);

        TextView mark = text("▱  run.cloud interaction proof", 19, Typeface.BOLD, CYAN);
        mark.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        content.addView(mark);
        content.addView(space(8));

        tapState = status("Tap count: 0", "tap-state");
        swipeState = status("Swipe: idle", "swipe-state");
        gestureState = status("Gesture: idle", "gesture-state");
        keyState = status("Key: none", "key-state");
        content.addView(tapState);
        content.addView(swipeState);
        content.addView(gestureState);
        content.addView(keyState);
        content.addView(space(9));

        Button tapButton = new Button(this);
        tapButton.setText("TAP TARGET");
        tapButton.setTextSize(16);
        tapButton.setTextColor(Color.WHITE);
        tapButton.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        tapButton.setContentDescription("tap-target");
        tapButton.setAllCaps(false);
        tapButton.setPadding(dp(12), 0, dp(12), 0);
        tapButton.setBackground(card(Color.rgb(26, 97, 117), CYAN, 12));
        tapButton.setOnClickListener((view) -> {
            tapCount += 1;
            tapState.setText("Tap count: " + tapCount);
        });
        content.addView(tapButton, fixedHeight(54));
        content.addView(space(9));

        EditText input = new EditText(this);
        input.setHint("Type text here");
        input.setHintTextColor(Color.rgb(145, 170, 181));
        input.setTextColor(Color.WHITE);
        input.setTextSize(16);
        input.setSingleLine(true);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setContentDescription("text-input");
        input.setPadding(dp(14), 0, dp(14), 0);
        input.setBackground(card(Color.rgb(22, 51, 60), Color.rgb(87, 111, 120), 12));
        input.setOnEditorActionListener((view, actionId, event) -> {
            boolean enter = actionId == EditorInfo.IME_ACTION_DONE
                || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER);
            if (!enter) return false;
            showKey("Enter");
            view.clearFocus();
            content.requestFocus();
            InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(view.getWindowToken(), 0);
            return true;
        });
        content.addView(input, fixedHeight(50));
        content.addView(space(9));

        GestureProofView gesture = new GestureProofView(this, (value) -> {
            gestureState.setText("Gesture: " + value);
        });
        gesture.setContentDescription("gesture-area");
        content.addView(gesture, fixedHeight(126));
        content.addView(space(9));

        ScrollView scroll = new ScrollView(this);
        scroll.setContentDescription("swipe-scroll");
        scroll.setFillViewport(false);
        scroll.setBackground(card(Color.rgb(15, 48, 57), Color.rgb(55, 79, 87), 12));
        scroll.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout cards = new LinearLayout(this);
        cards.setOrientation(LinearLayout.VERTICAL);
        cards.addView(scrollCard("SWIPE AREA", "Swipe up inside this panel"));
        cards.addView(space(12));
        cards.addView(scrollCard("KEEP GOING", "The state above changes after movement"));
        cards.addView(space(12));
        cards.addView(scrollCard("SWIPE COMPLETE", "This card confirms the viewport moved"));
        scroll.addView(cards, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));
        scroll.setOnScrollChangeListener((view, x, y, oldX, oldY) -> {
            if (y > dp(24)) swipeState.setText("Swipe: moved");
        });
        content.addView(scroll, fixedHeight(190));
        content.addView(space(9));
        content.addView(accessibilityProof());

        ScrollView page = new ScrollView(this);
        page.setFillViewport(true);
        page.addView(content, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));
        setContentView(page);
        content.post(() -> alignTapTarget(proofTopSpacer, tapButton));
        content.requestFocus();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN && !KeyEvent.isModifierKey(event.getKeyCode())) {
            String value = readableKey(event.getKeyCode());
            showKey(keyWithModifiers(event, value));
        }
        return super.dispatchKeyEvent(event);
    }

    private void showKey(String value) {
        if (keyState != null) keyState.setText("Key: " + value);
    }

    private void updateAccessibilityState() {
        accessibilityState.setText(
            "Notifications: " + (notificationsToggle.isChecked() ? "on" : "off")
                + " · Screen: " + (showingAccessibilityDetails ? "details" : "overview")
        );
    }

    private String keyWithModifiers(KeyEvent event, String key) {
        StringBuilder value = new StringBuilder();
        appendModifier(value, event.isCtrlPressed(), "Control");
        appendModifier(value, event.isAltPressed(), "Option");
        appendModifier(value, event.isShiftPressed(), "Shift");
        appendModifier(value, event.isMetaPressed(), "Command");
        value.append(key);
        return value.toString();
    }

    private void appendModifier(StringBuilder value, boolean present, String name) {
        if (present) value.append(name).append('+');
    }

    private TextView status(String value, String accessibilityId) {
        TextView view = text(value, 13, Typeface.NORMAL, MUTED);
        view.setTypeface(Typeface.MONOSPACE, Typeface.NORMAL);
        view.setContentDescription(accessibilityId);
        return view;
    }

    private View scrollCard(String title, String detail) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(card(Color.rgb(25, 61, 70), Color.TRANSPARENT, 10));
        TextView titleView = text(title, 14, Typeface.BOLD, GREEN);
        titleView.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        card.addView(titleView);
        card.addView(space(6));
        card.addView(text(detail, 13, Typeface.NORMAL, MUTED));
        card.setLayoutParams(fixedHeight(112));
        return card;
    }

    private View accessibilityProof() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(card(Color.rgb(25, 61, 70), Color.rgb(55, 79, 87), 12));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            card.setAccessibilityPaneTitle("Accessibility proof group");
        }

        TextView heading = text("ACCESSIBILITY PROOF", 15, Typeface.BOLD, GREEN);
        heading.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) heading.setAccessibilityHeading(true);
        card.addView(heading);

        accessibilityNestedLabel = status("Nested label: overview", null);
        accessibilityState = status("Notifications: off · Screen: overview", null);
        card.addView(accessibilityNestedLabel);
        card.addView(accessibilityState);
        card.addView(space(8));

        EditText name = accessibilityField("Name", "Ada", false);
        card.addView(name, fixedHeight(40));
        card.addView(space(8));

        EditText password = accessibilityField("Password", "runcloud-secret-42", true);
        card.addView(password, fixedHeight(40));
        card.addView(space(8));

        LinearLayout toggleRow = new LinearLayout(this);
        toggleRow.setOrientation(LinearLayout.HORIZONTAL);
        toggleRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView toggleLabel = text("Notifications", 14, Typeface.NORMAL, Color.WHITE);
        notificationsToggle = new Switch(this);
        notificationsToggle.setContentDescription("Notifications");
        notificationsToggle.setChecked(false);
        notificationsToggle.setOnCheckedChangeListener((button, checked) -> updateAccessibilityState());
        toggleRow.addView(toggleLabel, new LinearLayout.LayoutParams(0, dp(42), 1));
        toggleRow.addView(notificationsToggle, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            dp(42)
        ));
        card.addView(toggleRow);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button disabled = new Button(this);
        disabled.setText("SUBMIT DISABLED");
        disabled.setContentDescription("Submit");
        disabled.setEnabled(false);
        navigationButton = new Button(this);
        navigationButton.setText("OPEN DETAILS");
        navigationButton.setContentDescription("Open details");
        navigationButton.setOnClickListener((view) -> {
            showingAccessibilityDetails = !showingAccessibilityDetails;
            accessibilityNestedLabel.setText(
                showingAccessibilityDetails ? "Nested label: details" : "Nested label: overview"
            );
            navigationButton.setText(showingAccessibilityDetails ? "BACK TO OVERVIEW" : "OPEN DETAILS");
            navigationButton.setContentDescription(
                showingAccessibilityDetails ? "Back to overview" : "Open details"
            );
            updateAccessibilityState();
        });
        buttons.addView(disabled, new LinearLayout.LayoutParams(0, dp(44), 1));
        buttons.addView(navigationButton, new LinearLayout.LayoutParams(0, dp(44), 1));
        card.addView(buttons);
        return card;
    }

    private EditText accessibilityField(String label, String value, boolean secure) {
        EditText field = new EditText(this);
        field.setHint(label);
        field.setContentDescription(label);
        field.setText(value);
        field.setTextColor(Color.WHITE);
        field.setHintTextColor(Color.rgb(145, 170, 181));
        field.setTextSize(15);
        field.setSingleLine(true);
        field.setPadding(dp(12), 0, dp(12), 0);
        field.setBackground(card(Color.rgb(22, 51, 60), Color.rgb(87, 111, 120), 9));
        field.setInputType(
            InputType.TYPE_CLASS_TEXT
                | (secure ? InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_TEXT_VARIATION_NORMAL)
        );
        return field;
    }

    private TextView text(String value, int size, int style, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", style));
        return view;
    }

    private View space(int height) {
        View view = new View(this);
        view.setLayoutParams(new LinearLayout.LayoutParams(1, dp(height)));
        return view;
    }

    private LinearLayout.LayoutParams fixedHeight(int height) {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(height));
    }

    private GradientDrawable card(int fill, int stroke, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String readableKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP: return "ArrowUp";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "ArrowDown";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "ArrowLeft";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "ArrowRight";
            case KeyEvent.KEYCODE_ENTER: return "Enter";
            case KeyEvent.KEYCODE_ESCAPE: return "Escape";
            default: return KeyEvent.keyCodeToString(keyCode).replace("KEYCODE_", "");
        }
    }

    private void alignTapTarget(View spacer, View target) {
        View viewport = target.getRootView();
        int[] viewportLocation = new int[2];
        int[] targetLocation = new int[2];
        viewport.getLocationOnScreen(viewportLocation);
        target.getLocationOnScreen(targetLocation);
        int targetCenterWithoutSpacer = targetLocation[1]
            - viewportLocation[1]
            - spacer.getHeight()
            + target.getHeight() / 2;
        TapTargetAlignment.Result alignment = TapTargetAlignment.calculate(
            viewport.getHeight(),
            targetCenterWithoutSpacer,
            TAP_TARGET_NORMALIZED_Y
        );
        spacer.setLayoutParams(new LinearLayout.LayoutParams(1, alignment.spacerHeight));
        target.setTranslationY(alignment.translationY);
    }

    private interface GestureListener {
        void onState(String value);
    }

    private static final class GestureProofView extends TextView {
        private final GestureListener listener;
        private float originX;
        private float originY;
        private int maximumPointers;

        GestureProofView(Context context, GestureListener listener) {
            super(context);
            this.listener = listener;
            setText("GESTURE AREA\nDrag, hold, or use two fingers");
            setTextSize(14);
            setTextColor(Color.WHITE);
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
            setGravity(Gravity.CENTER);
            setClickable(true);
            setFocusable(true);
            GradientDrawable background = new GradientDrawable();
            background.setColor(Color.rgb(41, 64, 97));
            background.setStroke(dp(context, 1), Color.rgb(140, 166, 255));
            background.setCornerRadius(dp(context, 12));
            setBackground(background);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            int pointers = event.getPointerCount();
            maximumPointers = Math.max(maximumPointers, pointers);
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    originX = event.getX();
                    originY = event.getY();
                    maximumPointers = pointers;
                    listener.onState("started");
                    break;
                case MotionEvent.ACTION_POINTER_DOWN:
                    listener.onState("multi-touch");
                    break;
                case MotionEvent.ACTION_MOVE:
                    float distance = (float) Math.hypot(event.getX() - originX, event.getY() - originY);
                    if (maximumPointers > 1) listener.onState("multi-touch");
                    else if (distance > dp(getContext(), 12)) listener.onState("dragging");
                    break;
                case MotionEvent.ACTION_UP:
                    performClick();
                    break;
                case MotionEvent.ACTION_CANCEL:
                    listener.onState("cancelled");
                    break;
                default:
                    break;
            }
            return true;
        }

        @Override
        public boolean performClick() {
            super.performClick();
            listener.onState(maximumPointers > 1 ? "multi-touch complete" : "complete");
            return true;
        }

        private static int dp(Context context, int value) {
            return Math.round(value * context.getResources().getDisplayMetrics().density);
        }
    }
}
