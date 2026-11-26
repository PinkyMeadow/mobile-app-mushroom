package ca.sporeleaf.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrailPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
