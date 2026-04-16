/**
 * Bug Condition Exploration Test for Cursor Alignment Bug
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * GOAL: Surface counterexamples that demonstrate the bug exists
 * 
 * Property 1: Bug Condition - Cursor Alignment Offset Bug
 * Tests that mouse events in viewer produce coordinates with UI offsets affecting calculation
 */

/**
 * @jest-environment jsdom
 */

// Mock getBoundingClientRect to simulate the bug condition
// This simulates the rectTop: 52px header offset that causes the bug
const mockGetBoundingClientRect = (element, includeHeaderOffset = false) => {
  const baseRect = {
    left: 0,
    width: 800,
    height: 450,
    right: 800,
    bottom: 450
  };
  
  if (includeHeaderOffset) {
    // Simulate the bug: header offset affects coordinate calculation
    return {
      ...baseRect,
      top: 52, // This is the bug - header offset included in calculation
      bottom: 502
    };
  } else {
    return {
      ...baseRect,
      top: 0,
      bottom: 450
    };
  }
};

// Viewer-agent coordinate calculation (current buggy implementation)
function getCoords_ViewerAgent(e) {
  const video = document.getElementById('screen');
  const r = video.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  
  console.log('[DEBUG] Simple coordinate calculation:', {
    clientX: e.clientX,
    clientY: e.clientY,
    rectLeft: r.left,
    rectTop: r.top,
    rectWidth: r.width,
    rectHeight: r.height,
    finalX: x,
    finalY: y
  });
  
  return (x >= 0 && x <= 1 && y >= 0 && y <= 1) ? { x, y } : null;
}

// Frontend coordinate calculation (current buggy implementation)
function getCoords_Frontend(e) {
  const el = document.getElementById('container-ref');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  return (x >= 0 && x <= 1 && y >= 0 && y <= 1) ? { x, y } : null;
}

// Mock mouse event creator
function createMouseEvent(clientX, clientY, type = 'click') {
  return {
    clientX,
    clientY,
    type,
    button: 0
  };
}

describe('Cursor Alignment Bug Condition Exploration', () => {
  beforeEach(() => {
    // Set up DOM structure
    document.body.innerHTML = `
      <!-- Viewer-agent structure -->
      <div id="header" style="height: 52px; padding: 8px 16px;">Header content</div>
      <div id="video-wrap" style="position: relative; width: 800px; height: 450px;">
        <video id="screen" style="width: 100%; height: 100%; object-fit: contain;"></video>
      </div>
      
      <!-- Frontend structure -->
      <div class="video-container" id="container-ref" style="width: 800px; height: 450px;">
        <video id="frontend-video"></video>
      </div>
    `;
    
    // Mock getBoundingClientRect with header offset bug
    const video = document.getElementById('screen');
    const container = document.getElementById('container-ref');
    
    if (video) {
      video.getBoundingClientRect = () => mockGetBoundingClientRect(video, true);
    }
    if (container) {
      container.getBoundingClientRect = () => mockGetBoundingClientRect(container, true);
    }
  });

  describe('Property 1: Bug Condition - Cursor Alignment Offset Bug', () => {
    test('EXPECTED TO FAIL: Center click should produce normalized coordinates (0.5, 0.5) but shows offset due to rectTop: 52px header', () => {
      // Test center click at video center
      const centerX = 400; // Center of 800px width
      const centerY = 225; // Center of 450px height
      const mouseEvent = createMouseEvent(centerX, centerY);
      
      // Test viewer-agent implementation
      const viewerCoords = getCoords_ViewerAgent(mouseEvent);
      console.log('Viewer-agent center click coords:', viewerCoords);
      
      // Test frontend implementation  
      const frontendCoords = getCoords_Frontend(mouseEvent);
      console.log('Frontend center click coords:', frontendCoords);
      
      // EXPECTED BEHAVIOR: Center click should produce (0.5, 0.5)
      // ACTUAL BEHAVIOR (BUG): Will show offset due to header interference
      expect(viewerCoords).toEqual({ x: 0.5, y: 0.5 });
      expect(frontendCoords).toEqual({ x: 0.5, y: 0.5 });
    });

    test('EXPECTED TO FAIL: Corner clicks should produce boundary coordinates but show coordinate shifts', () => {
      const testCases = [
        { name: 'top-left', x: 0, y: 0, expected: { x: 0, y: 0 } },
        { name: 'top-right', x: 800, y: 0, expected: { x: 1, y: 0 } },
        { name: 'bottom-left', x: 0, y: 450, expected: { x: 0, y: 1 } },
        { name: 'bottom-right', x: 800, y: 450, expected: { x: 1, y: 1 } }
      ];
      
      testCases.forEach(({ name, x, y, expected }) => {
        const mouseEvent = createMouseEvent(x, y);
        
        const viewerCoords = getCoords_ViewerAgent(mouseEvent);
        const frontendCoords = getCoords_Frontend(mouseEvent);
        
        console.log(`${name} corner - Viewer:`, viewerCoords, 'Frontend:', frontendCoords);
        
        // EXPECTED BEHAVIOR: Corner clicks should produce exact boundary coordinates
        // ACTUAL BEHAVIOR (BUG): Will show coordinate shifts due to header offset
        expect(viewerCoords).toEqual(expected);
        expect(frontendCoords).toEqual(expected);
      });
    });

    test('EXPECTED TO FAIL: Coordinate range validation - all coordinates should be in 0-1 range but may exceed due to incorrect bounding rectangle', () => {
      // Test clicks at various positions that should be valid
      const testPositions = [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 600, y: 300 },
        { x: 700, y: 400 }
      ];
      
      testPositions.forEach(({ x, y }) => {
        const mouseEvent = createMouseEvent(x, y);
        
        const viewerCoords = getCoords_ViewerAgent(mouseEvent);
        const frontendCoords = getCoords_Frontend(mouseEvent);
        
        console.log(`Position (${x}, ${y}) - Viewer:`, viewerCoords, 'Frontend:', frontendCoords);
        
        // EXPECTED BEHAVIOR: All coordinates should be in valid 0-1 range
        // ACTUAL BEHAVIOR (BUG): May exceed range due to incorrect bounding rectangle
        if (viewerCoords) {
          expect(viewerCoords.x).toBeGreaterThanOrEqual(0);
          expect(viewerCoords.x).toBeLessThanOrEqual(1);
          expect(viewerCoords.y).toBeGreaterThanOrEqual(0);
          expect(viewerCoords.y).toBeLessThanOrEqual(1);
        }
        
        if (frontendCoords) {
          expect(frontendCoords.x).toBeGreaterThanOrEqual(0);
          expect(frontendCoords.x).toBeLessThanOrEqual(1);
          expect(frontendCoords.y).toBeGreaterThanOrEqual(0);
          expect(frontendCoords.y).toBeLessThanOrEqual(1);
        }
      });
    });

    test('EXPECTED TO FAIL: Header offset interference - coordinates should exclude header elements', () => {
      // Test click at the very top of the video area
      const topClick = createMouseEvent(400, 0); // Top center of video
      
      const viewerCoords = getCoords_ViewerAgent(topClick);
      const frontendCoords = getCoords_Frontend(topClick);
      
      console.log('Top click coords - Viewer:', viewerCoords, 'Frontend:', frontendCoords);
      
      // EXPECTED BEHAVIOR: Top click should produce y=0 (top of video)
      // ACTUAL BEHAVIOR (BUG): Will produce negative y due to header offset
      expect(viewerCoords?.y).toBe(0);
      expect(frontendCoords?.y).toBe(0);
    });

    test('EXPECTED TO FAIL: Debug logs should show rectTop: 52px indicating header offset affecting calculation', () => {
      const mouseEvent = createMouseEvent(400, 225);
      
      // Capture console output
      const consoleLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        consoleLogs.push(args.join(' '));
        originalLog(...args);
      };
      
      getCoords_ViewerAgent(mouseEvent);
      
      console.log = originalLog;
      
      // EXPECTED BEHAVIOR: Debug logs should NOT show header offset
      // ACTUAL BEHAVIOR (BUG): Will show rectTop: 52 indicating header interference
      const debugLog = consoleLogs.find(log => log.includes('rectTop'));
      expect(debugLog).toBeDefined();
      
      // This assertion will FAIL on unfixed code, proving the bug exists
      expect(debugLog).not.toContain('rectTop: 52');
    });
  });

  describe('Bug Root Cause Analysis', () => {
    test('Demonstrate the root cause: getBoundingClientRect includes header offset', () => {
      const video = document.getElementById('screen');
      const container = document.getElementById('container-ref');
      
      const videoRect = video.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      console.log('Video element bounding rect:', videoRect);
      console.log('Container element bounding rect:', containerRect);
      
      // Document the bug: rectTop should be 0 for proper coordinate calculation
      // but includes header offset of 52px
      expect(videoRect.top).toBe(0); // This will FAIL, showing rectTop: 52
      expect(containerRect.top).toBe(0); // This will FAIL, showing rectTop: 52
    });

    test('Show coordinate calculation with and without header offset', () => {
      const centerClick = createMouseEvent(400, 225);
      
      // Simulate correct behavior (without header offset)
      const video = document.getElementById('screen');
      video.getBoundingClientRect = () => mockGetBoundingClientRect(video, false);
      const correctCoords = getCoords_ViewerAgent(centerClick);
      
      // Simulate buggy behavior (with header offset)
      video.getBoundingClientRect = () => mockGetBoundingClientRect(video, true);
      const buggyCoords = getCoords_ViewerAgent(centerClick);
      
      console.log('Correct coords (no header offset):', correctCoords);
      console.log('Buggy coords (with header offset):', buggyCoords);
      
      // This demonstrates the difference caused by the header offset bug
      expect(correctCoords).toEqual({ x: 0.5, y: 0.5 });
      expect(buggyCoords).toEqual({ x: 0.5, y: 0.5 }); // This will FAIL due to header offset
    });
  });
});